import process from 'node:process';
import {
  createDataProcessingProbeBody,
  validateDataProcessingResponse,
} from './lib/live-data-processing-smoke.mjs';

const origin = (process.env.LIVE_DATA_PROCESSING_ORIGIN || 'https://airai.world').replace(/\/$/, '');
const routePath = process.env.LIVE_DATA_PROCESSING_PATH || '/lingbi/api/data-processing/plan';
const mode = process.env.LIVE_DATA_PROCESSING_MODE || 'account-gate';
const timeoutMs = Math.max(15_000, Number(process.env.LIVE_DATA_PROCESSING_TIMEOUT_MS) || 60_000);

async function main() {
  if (!['account-gate', 'full'].includes(mode)) throw new Error(`Unsupported LIVE_DATA_PROCESSING_MODE: ${mode}.`);
  const response = await fetch(new URL(routePath, `${origin}/`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createDataProcessingProbeBody()),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json();
  if (mode === 'account-gate') {
    if (response.status !== 401 || payload.errorType !== 'account_login_required') {
      throw new Error(`Data-processing account gate drifted: HTTP ${response.status}, ${payload.errorType || 'missing errorType'}.`);
    }
    console.log(JSON.stringify({ ok: true, mode, origin, routePath, accountGate: { status: response.status, errorType: payload.errorType } }, null, 2));
    return;
  }
  if (!response.ok) throw new Error(`Data-processing live request returned HTTP ${response.status}: ${payload.code || payload.errorType || payload.msg || 'unknown'}.`);
  console.log(JSON.stringify({ ok: true, mode, origin, routePath, ...validateDataProcessingResponse(payload) }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
