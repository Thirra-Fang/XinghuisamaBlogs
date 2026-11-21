#!/usr/bin/env bash
# Build a Next.js standalone release on Linux (e.g. CachyOS).
# Do not run this on Windows or copy Windows node_modules into the tree.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="${RELEASE_DIR:-$HOME/xhblogs-release}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"

cd "$ROOT"

if [[ "$(uname -s)" == "MINGW"* ]] || [[ "$(uname -s)" == "CYGWIN"* ]] || [[ "$(uname -s)" == MSYS* ]]; then
  echo "error: build on Linux (CachyOS / Debian container). Windows node_modules are not portable." >&2
  exit 1
fi

if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo "error: node and npm are required (Node.js >= 20.9)." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "error: Node.js >= 20.9 required, found $(node -v)." >&2
  exit 1
fi

if [[ "$SKIP_INSTALL" != "1" ]]; then
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
fi

npm run build

STANDALONE_ROOT="$ROOT/.next/standalone"
STANDALONE=""
if [[ -f "$STANDALONE_ROOT/server.js" ]]; then
  STANDALONE="$STANDALONE_ROOT"
else
  # Some Next layouts nest server.js one level deeper
  NESTED="$(find "$STANDALONE_ROOT" -maxdepth 2 -type f -name server.js 2>/dev/null | head -n 1 || true)"
  if [[ -n "$NESTED" ]]; then
    STANDALONE="$(dirname "$NESTED")"
  fi
fi

if [[ -z "$STANDALONE" || ! -f "$STANDALONE/server.js" ]]; then
  echo "error: missing .next/standalone/**/server.js — ensure next.config has output: 'standalone'." >&2
  exit 1
fi

rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
cp -a "$STANDALONE"/. "$RELEASE_DIR"/

mkdir -p "$RELEASE_DIR/.next"
rm -rf "$RELEASE_DIR/.next/static"
cp -a "$ROOT/.next/static" "$RELEASE_DIR/.next/static"

rm -rf "$RELEASE_DIR/public"
cp -a "$ROOT/public" "$RELEASE_DIR/public"

# Runtime Markdown / JSON content (process.cwd() relative)
for dir in posts moments chatters data; do
  if [[ -d "$ROOT/$dir" ]]; then
    rm -rf "$RELEASE_DIR/$dir"
    cp -a "$ROOT/$dir" "$RELEASE_DIR/$dir"
  else
    echo "warn: missing content dir: $dir" >&2
  fi
done

mkdir -p "$RELEASE_DIR/app/about"
if [[ -f "$ROOT/app/about/about.md" ]]; then
  cp -a "$ROOT/app/about/about.md" "$RELEASE_DIR/app/about/about.md"
else
  echo "warn: missing app/about/about.md" >&2
fi

# Optional: keep siteConfig in release for debugging (compiled into bundles already)
if [[ -f "$ROOT/siteConfig.ts" ]]; then
  cp -a "$ROOT/siteConfig.ts" "$RELEASE_DIR/siteConfig.ts"
fi

cat > "$RELEASE_DIR/.release-info" <<EOF
built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
node=$(node -v)
host=$(hostname 2>/dev/null || echo unknown)
source=$ROOT
EOF

echo "Release ready: $RELEASE_DIR"
echo "Next: ./deploy/rsync-deploy.sh user@debian-host"
