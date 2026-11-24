#!/usr/bin/env bash
# Build (optional) XHBlogs static out/ and rsync to each VPS /var/www/reality-fallback.
# Reads SSH aliases from scripts/hosts.conf (or HOSTS_FILE override). Step SSH with reconnect.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOSTS_FILE="${HOSTS_FILE:-$SCRIPT_DIR/hosts.conf}"
# Default: monorepo XHBlogs next to this scripts/ directory.
DEFAULT_SITE_ROOT="$(cd "$SCRIPT_DIR/../XHBlogs" 2>/dev/null && pwd || true)"
SITE_ROOT="${SITE_ROOT:-$DEFAULT_SITE_ROOT}"
OUT_DIR=""
REMOTE_LIVE="/var/www/reality-fallback"
REMOTE_NEXT="/var/www/reality-fallback.next"
REMOTE_OLD="/var/www/reality-fallback.prev"

ASSUME_YES=0
SKIP_BUILD=0
FILTER_HOST=""

RECONNECT_WAIT="${RECONNECT_WAIT:-5}"
RECONNECT_TRIES="${RECONNECT_TRIES:-5}"
STEP_RETRIES="${STEP_RETRIES:-2}"

OK_HOSTS=()
FAIL_HOSTS=()
FAIL_REASONS=()

H_NAME=""
SSH_OUT="" SSH_RC=0

usage() {
  cat <<'EOF'
Usage: deploy-fallback-site-remote.sh [--yes] [--skip-build] [--host NAME] [--site-root DIR] [--help]

  --yes           Non-interactive
  --skip-build    Do not run npm run build:static (require existing out/)
  --host NAME     Only this SSH alias
  --site-root DIR XHBlogs directory (default: ../XHBlogs relative to this script)
  --help          Show help

Syncs out/ → /var/www/reality-fallback on each host via incremental rsync
into a staging dir, then atomic mv swap. Does NOT modify Hy2/Xray/nginx.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) ASSUME_YES=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --host) FILTER_HOST="${2:-}"; shift 2 ;;
    --site-root) SITE_ROOT="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "[FAIL] Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ -z "${NO_COLOR:-}" && ( -t 1 || -n "${FORCE_COLOR:-}" || -n "${CLICOLOR_FORCE:-}" ) ]]; then
  C_INFO=$'\033[36m'
  C_SKIP=$'\033[33m'
  C_OK=$'\033[32m'
  C_FAIL=$'\033[31m'
  C_BOLD=$'\033[1m'
  C_RESET=$'\033[0m'
else
  C_INFO= C_SKIP= C_OK= C_FAIL= C_BOLD= C_RESET=
fi
C_WARN="$C_SKIP"

log()  { printf '%s\n' "$*"; }
info() { printf '%s[INFO]%s %s\n' "$C_INFO" "$C_RESET" "$*"; }
warn() { printf '%s[WARN]%s %s\n' "$C_WARN" "$C_RESET" "$*"; }
ok()   { printf '%s[OK]%s %s\n' "$C_OK" "$C_RESET" "$*"; }
fail() { printf '%s[FAIL]%s %s\n' "$C_FAIL" "$C_RESET" "$*" >&2; }

have_cmd() { command -v "$1" >/dev/null 2>&1; }

if [[ ! -f "$HOSTS_FILE" ]]; then
  fail "missing $HOSTS_FILE"
  exit 1
fi
for need in ssh rsync; do
  if ! have_cmd "$need"; then
    fail "missing dependency: $need"
    exit 1
  fi
done

if [[ -z "$SITE_ROOT" || ! -d "$SITE_ROOT" ]]; then
  fail "SITE_ROOT not found: ${SITE_ROOT:-<empty>} (set --site-root)"
  exit 1
fi
OUT_DIR="$SITE_ROOT/out"

ssh_base_opts=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)

ssh_raw() {
  local alias="$1"
  shift
  local -a cmd=(ssh "${ssh_base_opts[@]}" "$alias")
  set +e
  SSH_OUT="$("${cmd[@]}" "$@" 2>&1)"
  SSH_RC=$?
  set -e
  return 0
}

is_disconnect() {
  local rc="$1" out="$2"
  [[ "$rc" -eq 255 ]] && return 0
  echo "$out" | grep -qiE 'connection (closed|reset|refused|timed out)|broken pipe|closed by remote' && return 0
  return 1
}

step_ssh() {
  local step="$1"
  shift
  local remote_cmd="$1"
  local try=1 max=$STEP_RETRIES
  local disc_try=0

  info "${H_NAME}: step=${step} start"
  while true; do
    ssh_raw "$H_NAME" -- "bash -lc $(printf '%q' "$remote_cmd")"
    log "----- ${H_NAME} step=${step} output (exit ${SSH_RC}) -----"
    log "$SSH_OUT"
    log "----- end ${H_NAME} step=${step} -----"

    if [[ "$SSH_RC" -eq 0 ]]; then
      info "${H_NAME}: step=${step} ok"
      return 0
    fi

    if is_disconnect "$SSH_RC" "$SSH_OUT"; then
      disc_try=$((disc_try + 1))
      warn "${H_NAME}: ssh disconnected at step=${step} (exit ${SSH_RC})"
      if [[ "$disc_try" -gt "$RECONNECT_TRIES" ]]; then
        fail "${H_NAME}: reconnect exhausted at step=${step}"
        return 2
      fi
      info "${H_NAME}: waiting ${RECONNECT_WAIT}s (try ${disc_try}/${RECONNECT_TRIES})"
      sleep "$RECONNECT_WAIT"
      continue
    fi

    if [[ "$try" -lt "$max" ]]; then
      warn "${H_NAME}: step=${step} failed (exit ${SSH_RC}); retry ${try}/${max}"
      try=$((try + 1))
      sleep 2
      continue
    fi
    fail "${H_NAME}: step=${step} failed (exit ${SSH_RC})"
    return 1
  done
}

ensure_build() {
  if [[ "$SKIP_BUILD" -eq 1 ]]; then
    if [[ ! -f "$OUT_DIR/index.html" ]]; then
      fail "out/index.html missing and --skip-build set"
      exit 1
    fi
    info "skip build; using $OUT_DIR"
    return 0
  fi
  info "building static site in $SITE_ROOT ..."
  if [[ ! -d "$SITE_ROOT/node_modules" ]]; then
    (cd "$SITE_ROOT" && npm ci)
  fi
  (cd "$SITE_ROOT" && npm run build:static)
  if [[ ! -f "$OUT_DIR/index.html" ]]; then
    fail "build did not produce $OUT_DIR/index.html"
    exit 1
  fi
  ok "build ready: $OUT_DIR"
}

# Seed NEXT from LIVE (if any), then incremental rsync local out/ → NEXT.
upload_to_next() {
  local try=1 max=$STEP_RETRIES
  local disc_try=0
  local ssh_e rsync_out seed_out
  info "${H_NAME}: step=upload (rsync incremental) start"

  # Remote must have rsync for seed + receive
  ssh_raw "$H_NAME" -- "bash -lc $(printf '%q' "command -v rsync >/dev/null")"
  if [[ "$SSH_RC" -ne 0 ]]; then
    fail "${H_NAME}: remote missing rsync (apt install rsync)"
    log "$SSH_OUT"
    return 1
  fi

  while true; do
    set +e
    seed_out=$(
      ssh "${ssh_base_opts[@]}" "$H_NAME" -- "bash -lc $(printf '%q' "
set -euo pipefail
if [[ -d '$REMOTE_LIVE' ]]; then
  mkdir -p '$REMOTE_NEXT'
  rsync -a --delete '$REMOTE_LIVE'/ '$REMOTE_NEXT'/
else
  rm -rf '$REMOTE_NEXT'
  mkdir -p '$REMOTE_NEXT'
fi
echo seed_ok
")" 2>&1
    )
    SSH_RC=$?
    set -e
    log "----- ${H_NAME} step=seed output (exit ${SSH_RC}) -----"
    log "$seed_out"
    log "----- end ${H_NAME} step=seed -----"

    if [[ "$SSH_RC" -ne 0 ]]; then
      if is_disconnect "$SSH_RC" "$seed_out" || [[ "$SSH_RC" -eq 255 ]]; then
        disc_try=$((disc_try + 1))
        warn "${H_NAME}: seed/ssh issue (exit ${SSH_RC})"
        if [[ "$disc_try" -gt "$RECONNECT_TRIES" ]]; then
          return 2
        fi
        sleep "$RECONNECT_WAIT"
        continue
      fi
      if [[ "$try" -lt "$max" ]]; then
        try=$((try + 1))
        sleep 2
        continue
      fi
      return 1
    fi

    # Build ssh command string for rsync -e
    ssh_e="ssh"
    local opt
    for opt in "${ssh_base_opts[@]}"; do
      ssh_e+=" $(printf '%q' "$opt")"
    done

    set +e
    rsync_out=$(
      rsync -az --delete --info=stats2 \
        -e "$ssh_e" \
        "$OUT_DIR"/ "${H_NAME}:${REMOTE_NEXT}/" \
        2>&1
    )
    SSH_RC=$?
    set -e
    log "----- ${H_NAME} step=rsync output (exit ${SSH_RC}) -----"
    log "$rsync_out"
    log "----- end ${H_NAME} step=rsync -----"

    if [[ "$SSH_RC" -eq 0 ]]; then
      info "${H_NAME}: step=upload ok"
      return 0
    fi
    if is_disconnect "$SSH_RC" "$rsync_out" || [[ "$SSH_RC" -eq 255 ]]; then
      disc_try=$((disc_try + 1))
      warn "${H_NAME}: rsync/ssh issue (exit ${SSH_RC})"
      if [[ "$disc_try" -gt "$RECONNECT_TRIES" ]]; then
        return 2
      fi
      sleep "$RECONNECT_WAIT"
      continue
    fi
    if [[ "$try" -lt "$max" ]]; then
      try=$((try + 1))
      sleep 2
      continue
    fi
    return 1
  done
}

process_host() {
  H_NAME="$1"
  info "=== host ${H_NAME} — deploy fallback site ==="

  upload_to_next || { FAIL_HOSTS+=("$H_NAME"); FAIL_REASONS+=("${H_NAME}: upload"); return 0; }

  step_ssh "activate" "
set -euo pipefail
test -f '$REMOTE_NEXT/index.html'
# ownership for nginx
if id www-data >/dev/null 2>&1; then
  chown -R www-data:www-data '$REMOTE_NEXT'
elif id nginx >/dev/null 2>&1; then
  chown -R nginx:nginx '$REMOTE_NEXT'
fi
rm -rf '$REMOTE_OLD'
if [[ -d '$REMOTE_LIVE' ]]; then
  mv '$REMOTE_LIVE' '$REMOTE_OLD'
fi
mv '$REMOTE_NEXT' '$REMOTE_LIVE'
test -f '$REMOTE_LIVE/index.html'
# keep one previous backup only
rm -rf '$REMOTE_OLD'
ls -la '$REMOTE_LIVE' | head -n 20
echo activate_ok
" || { FAIL_HOSTS+=("$H_NAME"); FAIL_REASONS+=("${H_NAME}: activate"); return 0; }

  step_ssh "verify-local" "
set -euo pipefail
code=\$(curl -sk -o /dev/null -w '%{http_code}' --resolve thirra.com:8443:127.0.0.1 https://thirra.com:8443/)
echo http=\$code
[[ \"\$code\" == \"200\" ]]
# sanity: not the old It works page
! curl -sk --resolve thirra.com:8443:127.0.0.1 https://thirra.com:8443/ | grep -q '<h1>It works.</h1>'
echo verify_ok
" || { FAIL_HOSTS+=("$H_NAME"); FAIL_REASONS+=("${H_NAME}: verify-local"); return 0; }

  ok "${H_NAME}: finished successfully"
  OK_HOSTS+=("$H_NAME")
}

declare -a NAMES
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"
  line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  [[ -z "$line" ]] && continue
  # shellcheck disable=SC2086
  set -- $line
  name="${1:-}"
  if [[ -z "$name" || $# -gt 1 ]]; then
    fail "bad hosts.conf line: $line"
    exit 1
  fi
  if [[ -n "$FILTER_HOST" && "$name" != "$FILTER_HOST" ]]; then
    continue
  fi
  NAMES+=("$name")
done < "$HOSTS_FILE"

if [[ ${#NAMES[@]} -eq 0 ]]; then
  fail "no hosts in $HOSTS_FILE"
  exit 1
fi

info "site: $SITE_ROOT"
info "out:  $OUT_DIR"
info "hosts: ${NAMES[*]}"

if [[ "$ASSUME_YES" -eq 0 ]]; then
  printf '%s[INFO]%s Deploy fallback site to [%s]? [y/N] ' "$C_INFO" "$C_RESET" "${NAMES[*]}"
  read -r ans || true
  case "${ans:-}" in
    y|Y|yes|YES) ;;
    *) info "Aborted."; exit 0 ;;
  esac
fi

ensure_build

for ((i=0; i<${#NAMES[@]}; i++)); do
  process_host "${NAMES[$i]}"
  if [[ $((i + 1)) -lt ${#NAMES[@]} ]]; then
    sleep 2
  fi
done

info "=== public check ==="
set +e
curl -sI --connect-timeout 20 https://thirra.com/ 2>&1 | head -n 15
set -e

printf '%s======== HOST SUMMARY ========%s\n' "$C_BOLD" "$C_RESET"
log "  OK=${#OK_HOSTS[@]}  FAIL=${#FAIL_HOSTS[@]}"
if [[ ${#OK_HOSTS[@]} -gt 0 ]]; then
  printf '%s--- OK ---%s\n' "$C_OK" "$C_RESET"
  for h in "${OK_HOSTS[@]}"; do log "  - $h"; done
fi
if [[ ${#FAIL_HOSTS[@]} -gt 0 ]]; then
  printf '%s--- FAIL ---%s\n' "$C_FAIL" "$C_RESET"
  for h in "${FAIL_HOSTS[@]}"; do log "  - $h"; done
  for r in "${FAIL_REASONS[@]}"; do log "  - $r"; done
  exit 1
fi
exit 0
