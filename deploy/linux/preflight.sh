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

failures=0

check_ok() {
  printf '[ok] %s\n' "$1"
}

check_fail() {
  printf '[fail] %s\n' "$1" >&2
  failures=$((failures + 1))
}

echo "Lingbi Studio deploy preflight"
echo "app_dir=$APP_DIR"
echo "kernel=$(uname -srm 2>/dev/null || echo unknown)"
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "os=${PRETTY_NAME:-unknown}"
fi

if command -v node >/dev/null 2>&1; then
  node_major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
  if [ "$node_major" -ge 20 ]; then
    check_ok "Node.js $(node --version)"
  else
    check_fail "Node.js 20+ required, current $(node --version)"
  fi
else
  check_fail "Node.js 20+ is missing"
fi

if command -v pnpm >/dev/null 2>&1; then
  pnpm_version="$(pnpm --version 2>/dev/null || true)"
  if [ -n "$pnpm_version" ]; then
    check_ok "pnpm $pnpm_version"
  else
    check_fail "pnpm command exists but is not usable"
  fi
else
  check_fail "pnpm is missing"
fi

for binary in tar curl; do
  if command -v "$binary" >/dev/null 2>&1; then
    check_ok "$binary available"
  else
    check_fail "$binary is missing"
  fi
done

for artifact in dist/server.js .next/BUILD_ID public package.json pnpm-lock.yaml .env.production.example; do
  if [ -e "$artifact" ]; then
    check_ok "artifact $artifact"
  else
    check_fail "missing artifact $artifact"
  fi
done

if [ -f .env.production ]; then
  check_ok ".env.production present"
  ENV_PORT="${PORT:-}"
  ENV_DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-}"
  set -a
  # shellcheck disable=SC1091
  source .env.production
  set +a
  if [ -n "$ENV_PORT" ]; then PORT="$ENV_PORT"; fi
  if [ -n "$ENV_DEPLOY_RUN_PORT" ]; then DEPLOY_RUN_PORT="$ENV_DEPLOY_RUN_PORT"; fi
else
  check_fail ".env.production missing; run ./install.sh or copy .env.production.example"
fi

PORT="${PORT:-5000}"
if command -v ss >/dev/null 2>&1; then
  if ss -H -lnt "( sport = :$PORT )" | grep -q .; then
    check_fail "port $PORT is already listening"
  else
    check_ok "port $PORT is available"
  fi
else
  check_ok "ss not installed; skipped port availability check"
fi

SOURCE_STORE_PATH="${SOURCE_STORE_PATH:-$APP_DIR/.data/sources/sources.json}"
ZVEC_STORE_PATH="${ZVEC_STORE_PATH:-$APP_DIR/.data/zvec}"
STUDIO_JOB_STORE_PATH="${STUDIO_JOB_STORE_PATH:-$APP_DIR/.data/studio-jobs/jobs.json}"
SCIENTIFIC_ILLUSTRATION_STORE_DIR="${SCIENTIFIC_ILLUSTRATION_STORE_DIR:-$APP_DIR/.data/scientific-illustrations}"
for dir in "$(dirname "$SOURCE_STORE_PATH")" "$(dirname "$STUDIO_JOB_STORE_PATH")" "$ZVEC_STORE_PATH" "$SCIENTIFIC_ILLUSTRATION_STORE_DIR" logs; do
  if [ -d "$dir" ] && [ -w "$dir" ]; then
    check_ok "writable directory $dir"
  elif [ -d "$dir" ]; then
    check_fail "directory exists but is not writable: $dir"
  else
    parent="$(dirname "$dir")"
    while [ ! -e "$parent" ] && [ "$parent" != "/" ] && [ "$parent" != "." ]; do
      parent="$(dirname "$parent")"
    done
    if [ "$parent" = "." ]; then
      parent="$APP_DIR"
    fi
    if [ -w "$parent" ]; then
      check_ok "directory can be created from $parent to $dir"
    else
      check_fail "directory missing and parent is not writable: $dir"
    fi
  fi
done

if [ "$failures" -gt 0 ]; then
  echo "Preflight failed with $failures issue(s)." >&2
  exit 1
fi

echo "Preflight passed."
