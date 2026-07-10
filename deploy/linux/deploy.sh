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

run_script() {
  local script_path="$1"
  shift || true
  if [ -x "$script_path" ]; then
    "$script_path" "$@"
  else
    bash "$script_path" "$@"
  fi
}

if ! command -v node >/dev/null 2>&1 || [ "$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)" -lt 20 ] || ! command -v pnpm >/dev/null 2>&1; then
  if [ -f "$APP_DIR/bootstrap-ubuntu.sh" ]; then
    run_script "$APP_DIR/bootstrap-ubuntu.sh"
  elif [ -f "$APP_DIR/deploy/linux/bootstrap-ubuntu.sh" ]; then
    run_script "$APP_DIR/deploy/linux/bootstrap-ubuntu.sh"
  else
    echo "Node.js 20+ and pnpm are required, and bootstrap-ubuntu.sh was not found." >&2
    exit 1
  fi
fi

if [ -n "${RELEASE_ENV_SOURCE:-}" ]; then
  node "$APP_DIR/scripts/prepare-release-env.mjs" "$RELEASE_ENV_SOURCE" "$APP_DIR/.env.production"
elif [ "${REQUIRE_RELEASE_ENV_SOURCE:-false}" = "true" ]; then
  echo "RELEASE_ENV_SOURCE is required for a guarded production release." >&2
  exit 1
fi

run_script "$APP_DIR/install.sh"

if [ -f "$APP_DIR/preflight.sh" ]; then
  run_script "$APP_DIR/preflight.sh"
elif [ -f "$APP_DIR/deploy/linux/preflight.sh" ]; then
  run_script "$APP_DIR/deploy/linux/preflight.sh"
fi

started_pid=""
if [ -f "$APP_DIR/logs/server.pid" ] && kill -0 "$(cat "$APP_DIR/logs/server.pid")" >/dev/null 2>&1; then
  echo "Existing Lingbi Studio process is running: pid $(cat "$APP_DIR/logs/server.pid")"
else
  mkdir -p "$APP_DIR/logs"
  if [ -x "$APP_DIR/start.sh" ]; then
    nohup "$APP_DIR/start.sh" > "$APP_DIR/logs/server.log" 2>&1 &
  else
    nohup bash "$APP_DIR/start.sh" > "$APP_DIR/logs/server.log" 2>&1 &
  fi
  echo "$!" > "$APP_DIR/logs/server.pid"
  started_pid="$(cat "$APP_DIR/logs/server.pid")"
  echo "Started Lingbi Studio: pid $(cat "$APP_DIR/logs/server.pid"), log $APP_DIR/logs/server.log"
fi

PORT="${PORT:-5000}"
for _ in $(seq 1 30); do
  if [ -n "$started_pid" ] && ! kill -0 "$started_pid" >/dev/null 2>&1; then
    echo "Started Lingbi Studio process exited before healthcheck passed. Recent logs:" >&2
    tail -n 80 "$APP_DIR/logs/server.log" >&2 || true
    exit 1
  fi
  if APP_ORIGIN="${APP_ORIGIN:-http://127.0.0.1:$PORT}" run_script "$APP_DIR/healthcheck.sh"; then
    if [ "${RELEASE_HEALTH_STRICT:-false}" = "true" ]; then
      node "$APP_DIR/scripts/verify-release-health.mjs" "${APP_ORIGIN:-http://127.0.0.1:$PORT}" "${RELEASE_SHARED_ROOT:-/opt/knowtrail/shared}"
    fi
    echo "Deploy complete."
    exit 0
  fi
  sleep 1
done

echo "Service did not become healthy within 30 seconds. Recent logs:" >&2
tail -n 80 "$APP_DIR/logs/server.log" >&2 || true
exit 1
