#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-5000}"
ORIGIN="${APP_ORIGIN:-http://127.0.0.1:$PORT}"

node -e "
const origin = process.env.APP_ORIGIN || '$ORIGIN';
fetch(origin.replace(/\/$/, '') + '/api/health')
  .then(async response => {
    const body = await response.json();
    if (!response.ok || body.ok !== true) {
      console.error(JSON.stringify({ status: response.status, body }, null, 2));
      process.exit(1);
    }
    console.log(JSON.stringify({
      ok: true,
      service: body.service,
      sourceStore: body.capabilities?.sourceStore,
      vectorStore: body.capabilities?.vectorStore,
      limits: body.limits,
    }, null, 2));
  })
  .catch(error => {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  });
"
