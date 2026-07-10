import process from 'node:process';
import {
  consumeHypothesisGenerationSse,
  createHypothesisGenerationProbeBody,
  validateHypothesisGenerationResult,
} from './lib/live-hypothesis-generation-smoke.mjs';

const origin = (process.env.LIVE_HYPOTHESIS_GENERATION_ORIGIN || 'https://airai.world').replace(/\/$/, '');
const routePath = process.env.LIVE_HYPOTHESIS_GENERATION_PATH || '/lingbi/api/ai/hypothesis-generation';
const mode = process.env.LIVE_HYPOTHESIS_GENERATION_MODE || 'account-gate';
const timeoutMs = Math.max(30_000, Number(process.env.LIVE_HYPOTHESIS_GENERATION_TIMEOUT_MS) || 180_000);
const requireBilling = process.env.LIVE_HYPOTHESIS_GENERATION_REQUIRE_BILLING === 'true';

async function main() {
  if (!['account-gate', 'full'].includes(mode)) throw new Error(`Unsupported LIVE_HYPOTHESIS_GENERATION_MODE: ${mode}.`);
  const response = await fetch(new URL(routePath, `${origin}/`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createHypothesisGenerationProbeBody()),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (mode === 'account-gate') {
    const payload = await response.json();
    if (response.status !== 401 || payload.errorType !== 'account_login_required') {
      throw new Error(`Hypothesis-generation account gate drifted: HTTP ${response.status}, ${payload.errorType || 'missing errorType'}.`);
    }
    console.log(JSON.stringify({ ok: true, mode, origin, routePath, accountGate: { status: response.status, errorType: payload.errorType } }, null, 2));
    return;
  }

  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`Hypothesis-generation live request returned HTTP ${response.status}: ${body}`);
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error(`Hypothesis-generation live request did not return SSE: ${response.headers.get('content-type') || 'missing'}.`);
  }
  const result = await consumeHypothesisGenerationSse(response.body);
  const summary = validateHypothesisGenerationResult(result, { requireBilling });
  console.log(JSON.stringify({ ok: true, mode, origin, routePath, ...summary }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
