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

OBSERVABILITY_HASH_KEY="${KNOWTRAIL_OBSERVABILITY_HASH_KEY:-}"
if [ "${APP_RUNTIME_ENV:-${NODE_ENV:-production}}" = "production" ] && [ "${#OBSERVABILITY_HASH_KEY}" -lt 32 ]; then
  printf '%s\n' '{"level":"error","service":"knowtrail","event":"startup_blocked","blocker":"observability_identity_hash_unavailable","exitCode":78}' >&2
  exit 78
fi

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
export SCIENTIFIC_ILLUSTRATION_STORE_DIR="${SCIENTIFIC_ILLUSTRATION_STORE_DIR:-$APP_DIR/.data/scientific-illustrations}"
export SOURCE_STORE_ADAPTER="${SOURCE_STORE_ADAPTER:-local-json}"

mkdir -p "$(dirname "$SOURCE_STORE_PATH")" "$(dirname "$STUDIO_JOB_STORE_PATH")" "$ZVEC_STORE_PATH" "$SCIENTIFIC_ILLUSTRATION_STORE_DIR" logs

CLASSROOM_SERVER="$APP_DIR/.references/OpenMAIC/.next/standalone/server.js"
if [ ! -f "$CLASSROOM_SERVER" ]; then
  CLASSROOM_SERVER="$APP_DIR/.references/OpenMAIC/.next/standalone/.references/OpenMAIC/server.js"
fi
CLASSROOM_PID=""
if [ -f "$CLASSROOM_SERVER" ]; then
  export OPENMAIC_SIDECAR_PORT="${OPENMAIC_SIDECAR_PORT:-5025}"
  export OPENMAIC_SIDECAR_HOST="${OPENMAIC_SIDECAR_HOST:-127.0.0.1}"
  export NEXT_PUBLIC_VIRTUAL_CLASSROOM_ORIGIN="${NEXT_PUBLIC_VIRTUAL_CLASSROOM_ORIGIN:-/classroom-runtime}"
  export VIRTUAL_CLASSROOM_INTERNAL_ORIGIN="${VIRTUAL_CLASSROOM_INTERNAL_ORIGIN:-http://${OPENMAIC_SIDECAR_HOST}:${OPENMAIC_SIDECAR_PORT}}"

  STUDIO_JOB_STORE_DIR="$(dirname "$STUDIO_JOB_STORE_PATH")"
  SHARED_DATA_ROOT="${RELEASE_SHARED_ROOT:-$(dirname "$STUDIO_JOB_STORE_DIR")}"
  export VIRTUAL_CLASSROOM_STORE_DIR="${VIRTUAL_CLASSROOM_STORE_DIR:-$SHARED_DATA_ROOT/virtual-classroom}"
  CLASSROOM_DATA_DIR="$(dirname "$CLASSROOM_SERVER")/data"
  case "$CLASSROOM_DATA_DIR" in
    "$APP_DIR"/.references/OpenMAIC/*/data) ;;
    *) echo "Refusing unsafe classroom data path: $CLASSROOM_DATA_DIR" >&2; exit 1 ;;
  esac
  mkdir -p "$VIRTUAL_CLASSROOM_STORE_DIR"
  if [ -d "$CLASSROOM_DATA_DIR" ] && [ ! -L "$CLASSROOM_DATA_DIR" ]; then
    cp -a "$CLASSROOM_DATA_DIR/." "$VIRTUAL_CLASSROOM_STORE_DIR/"
    rm -rf "$CLASSROOM_DATA_DIR"
  fi
  if [ ! -L "$CLASSROOM_DATA_DIR" ]; then
    ln -s "$VIRTUAL_CLASSROOM_STORE_DIR" "$CLASSROOM_DATA_DIR"
  fi

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
