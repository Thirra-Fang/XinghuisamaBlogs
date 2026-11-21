#!/usr/bin/env bash
# Sync a local release directory to Debian and restart the xhblogs service.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: rsync-deploy.sh [user@]host [options]

Options:
  --release DIR   Local release dir (default: $RELEASE_DIR or ~/xhblogs-release)
  --remote DIR    Remote app dir (default: /var/www/xhblogs/app)
  --no-restart    Skip systemctl restart
  -h, --help      Show help

Example:
  ./deploy/rsync-deploy.sh deploy@blog.example.com
  RELEASE_DIR=/tmp/xhblogs-release ./deploy/rsync-deploy.sh root@1.2.3.4
EOF
}

REMOTE_HOST=""
RELEASE_DIR="${RELEASE_DIR:-$HOME/xhblogs-release}"
REMOTE_DIR="${REMOTE_DIR:-/var/www/xhblogs/app}"
DO_RESTART=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --release)
      RELEASE_DIR="$2"
      shift 2
      ;;
    --remote)
      REMOTE_DIR="$2"
      shift 2
      ;;
    --no-restart)
      DO_RESTART=0
      shift
      ;;
    -*)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      if [[ -z "$REMOTE_HOST" ]]; then
        REMOTE_HOST="$1"
        shift
      else
        echo "error: unexpected argument: $1" >&2
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$REMOTE_HOST" ]]; then
  usage >&2
  exit 1
fi

if [[ ! -f "$RELEASE_DIR/server.js" ]]; then
  echo "error: $RELEASE_DIR/server.js not found. Run ./deploy/build-release.sh first." >&2
  exit 1
fi

if ! command -v rsync >/dev/null; then
  echo "error: rsync is required." >&2
  exit 1
fi

echo "Syncing $RELEASE_DIR/ -> ${REMOTE_HOST}:${REMOTE_DIR}/"
rsync -avz --delete \
  --exclude '.env' \
  --exclude '.env.*' \
  "$RELEASE_DIR"/ \
  "${REMOTE_HOST}:${REMOTE_DIR}/"

if [[ "$DO_RESTART" -eq 1 ]]; then
  echo "Restarting xhblogs on $REMOTE_HOST ..."
  ssh "$REMOTE_HOST" 'sudo systemctl restart xhblogs && sudo systemctl --no-pager --full status xhblogs'
fi

echo "Deploy finished."
