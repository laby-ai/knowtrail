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

ENV_PORT="${PORT:-}"
ENV_DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-}"
if [ -f .env.production ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.production
  set +a
fi
if [ -f .env.real.local ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.real.local
  set +a
fi
if [ -n "$ENV_PORT" ]; then PORT="$ENV_PORT"; fi
if [ -n "$ENV_DEPLOY_RUN_PORT" ]; then DEPLOY_RUN_PORT="$ENV_DEPLOY_RUN_PORT"; fi

if [ -z "${ARK_API_BASE:-}" ] && [ -n "${ARK_AGENTPLAN_API_BASE:-}" ]; then
  export ARK_API_BASE="$ARK_AGENTPLAN_API_BASE"
fi
if [ -z "${ARK_API_KEY:-}" ] && [ -n "${ARK_AGENTPLAN_API_KEY:-}" ]; then
  export ARK_API_KEY="$ARK_AGENTPLAN_API_KEY"
fi
if [ -z "${ARK_MODEL:-}" ] && [ -n "${ARK_AGENTPLAN_TEXT_MODEL:-}" ]; then
  export ARK_MODEL="$ARK_AGENTPLAN_TEXT_MODEL"
fi

export APP_RUNTIME_ENV="${APP_RUNTIME_ENV:-production}"
export PORT="${PORT:-5000}"
export DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-$PORT}"
export FILE_STORAGE_ADAPTER="${FILE_STORAGE_ADAPTER:-local}"
export ZVEC_STORE_PATH="${ZVEC_STORE_PATH:-$APP_DIR/.data/zvec}"
export SOURCE_STORE_PATH="${SOURCE_STORE_PATH:-$APP_DIR/.data/sources/sources.json}"
export STUDIO_JOB_STORE_PATH="${STUDIO_JOB_STORE_PATH:-$APP_DIR/.data/studio-jobs/jobs.json}"
export SOURCE_STORE_ADAPTER="${SOURCE_STORE_ADAPTER:-local-json}"

mkdir -p "$(dirname "$SOURCE_STORE_PATH")" "$(dirname "$STUDIO_JOB_STORE_PATH")" "$ZVEC_STORE_PATH" logs

CLASSROOM_SERVER="$APP_DIR/.references/OpenMAIC/.next/standalone/.references/OpenMAIC/server.js"
CLASSROOM_PID=""
if [ -f "$CLASSROOM_SERVER" ]; then
  export OPENMAIC_SIDECAR_PORT="${OPENMAIC_SIDECAR_PORT:-5025}"
  export OPENMAIC_SIDECAR_HOST="${OPENMAIC_SIDECAR_HOST:-127.0.0.1}"
  export NEXT_PUBLIC_VIRTUAL_CLASSROOM_ORIGIN="${NEXT_PUBLIC_VIRTUAL_CLASSROOM_ORIGIN:-/classroom-runtime}"
  export VIRTUAL_CLASSROOM_INTERNAL_ORIGIN="${VIRTUAL_CLASSROOM_INTERNAL_ORIGIN:-http://${OPENMAIC_SIDECAR_HOST}:${OPENMAIC_SIDECAR_PORT}/classroom-runtime}"

  CLASSROOM_HEALTH_URL="${VIRTUAL_CLASSROOM_INTERNAL_ORIGIN%/}/api/health"
  if ! curl -fsS "$CLASSROOM_HEALTH_URL" >/dev/null 2>&1; then
    node scripts/start-openmaic-sidecar-real.mjs > logs/classroom-runtime.log 2>&1 &
    CLASSROOM_PID="$!"
  fi
fi

cleanup() {
  if [ -n "$CLASSROOM_PID" ] && kill -0 "$CLASSROOM_PID" >/dev/null 2>&1; then
    kill "$CLASSROOM_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

exec node scripts/start.mjs
