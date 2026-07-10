import process from 'node:process';
import {
  consumeDeepResearchSse,
  createDeepResearchProbeBody,
  validateDeepResearchResult,
} from './lib/live-deep-research-smoke.mjs';

const origin = (process.env.LIVE_DEEP_RESEARCH_ORIGIN || 'https://airai.world').replace(/\/$/, '');
const routePath = process.env.LIVE_DEEP_RESEARCH_PATH || '/lingbi/api/ai/deep-research';
const mode = process.env.LIVE_DEEP_RESEARCH_MODE || 'account-gate';
const timeoutMs = Math.max(30_000, Number(process.env.LIVE_DEEP_RESEARCH_TIMEOUT_MS) || 180_000);
const requireBilling = process.env.LIVE_DEEP_RESEARCH_REQUIRE_BILLING === 'true';

async function main() {
  if (!['account-gate', 'full'].includes(mode)) {
    throw new Error(`Unsupported LIVE_DEEP_RESEARCH_MODE: ${mode}.`);
  }
  const url = new URL(routePath, `${origin}/`).toString();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createDeepResearchProbeBody()),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (mode === 'account-gate') {
    const payload = await response.json();
    if (response.status !== 401 || payload.errorType !== 'account_login_required') {
      throw new Error(`Deep research account gate drifted: HTTP ${response.status}, ${payload.errorType || 'missing errorType'}.`);
    }
    console.log(JSON.stringify({
      ok: true,
      mode,
      origin,
      routePath,
      accountGate: { status: response.status, errorType: payload.errorType },
    }, null, 2));
    return;
  }

  if (!response.ok) {
    const text = (await response.text()).slice(0, 500);
    throw new Error(`Deep research live request returned HTTP ${response.status}: ${text}`);
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error(`Deep research live request did not return SSE: ${response.headers.get('content-type') || 'missing'}.`);
  }
  const result = await consumeDeepResearchSse(response.body);
  const summary = validateDeepResearchResult(result, { requireBilling });
  console.log(JSON.stringify({
    ok: true,
    mode,
    origin,
    routePath,
    ...summary,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
