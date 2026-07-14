#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/package.json" ]; then
  APP_DIR="$SCRIPT_DIR"
elif [ -f "$SCRIPT_DIR/../../package.json" ]; then
  APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
else
  echo "Unable to locate package.json from $SCRIPT_DIR." >&2
  exit 1
fi
cd "$APP_DIR"

CLASSROOM_RUNTIME_ARCHIVE="$APP_DIR/runtime/openmaic-runtime.tar.gz"
if [ -f "$CLASSROOM_RUNTIME_ARCHIVE" ]; then
  CLASSROOM_RUNTIME_ENTRIES="$(tar -tzf "$CLASSROOM_RUNTIME_ARCHIVE" | sed 's#^\./##')"
  if grep -Eq '(^/|(^|/)\.\.(/|$))' <<< "$CLASSROOM_RUNTIME_ENTRIES"; then
    echo "OpenMAIC runtime archive contains an unsafe path." >&2
    exit 1
  fi
  for required in '.next/standalone/server.js' '.next/static/' 'public/'; do
    if ! grep -Fq "$required" <<< "$CLASSROOM_RUNTIME_ENTRIES"; then
      echo "OpenMAIC runtime archive is missing $required." >&2
      exit 1
    fi
  done
  mkdir -p "$APP_DIR/.references/OpenMAIC"
  tar -xzf "$CLASSROOM_RUNTIME_ARCHIVE" -C "$APP_DIR/.references/OpenMAIC"
  rm -f "$CLASSROOM_RUNTIME_ARCHIVE"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required. Install Node.js before running install.sh." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js 20+ is required. Current: $(node --version)" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    corepack enable
    corepack prepare pnpm@latest --activate
  else
    echo "pnpm is required. Install pnpm or enable corepack before running install.sh." >&2
    exit 1
  fi
fi

mkdir -p .data/zvec .data/sources logs

if [ ! -f .env.production ]; then
  cp .env.production.example .env.production
  echo "Created .env.production from .env.production.example. Review it before starting the service."
fi

pnpm install --prod --frozen-lockfile
node scripts/ensure-next-external-aliases.mjs

node -e "const fs=require('fs'); for (const p of ['dist/server.js','.next/BUILD_ID','public']) { if (!fs.existsSync(p)) { console.error('Missing runtime artifact:', p); process.exit(1); } } const archive='runtime/openmaic-runtime.tar.gz'; if (fs.existsSync(archive) && !['.references/OpenMAIC/.next/standalone/server.js','.references/OpenMAIC/.next/standalone/.references/OpenMAIC/server.js'].some(p=>fs.existsSync(p))) { console.error('OpenMAIC runtime archive did not produce a standalone server.'); process.exit(1); }"

echo "Install complete. Start with: ./start.sh"
