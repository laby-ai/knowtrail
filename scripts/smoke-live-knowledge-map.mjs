import process from 'node:process';
import {
  createKnowledgeMapProbeBody,
  validateKnowledgeMapResponse,
} from './lib/live-knowledge-map-smoke.mjs';

const origin = (process.env.LIVE_KNOWLEDGE_MAP_ORIGIN || 'https://airai.world').replace(/\/$/, '');
const routePath = process.env.LIVE_KNOWLEDGE_MAP_PATH || '/lingbi/api/ai/knowledge-map';
const mode = process.env.LIVE_KNOWLEDGE_MAP_MODE || 'account-gate';
const timeoutMs = Math.max(15_000, Number(process.env.LIVE_KNOWLEDGE_MAP_TIMEOUT_MS) || 60_000);

async function main() {
  if (!['account-gate', 'full'].includes(mode)) throw new Error(`Unsupported LIVE_KNOWLEDGE_MAP_MODE: ${mode}.`);
  const response = await fetch(new URL(routePath, `${origin}/`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createKnowledgeMapProbeBody()),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json();
  if (mode === 'account-gate') {
    if (response.status !== 401 || payload.errorType !== 'account_login_required') {
      throw new Error(`Knowledge-map account gate drifted: HTTP ${response.status}, ${payload.errorType || 'missing errorType'}.`);
    }
    console.log(JSON.stringify({ ok: true, mode, origin, routePath, accountGate: { status: response.status, errorType: payload.errorType } }, null, 2));
    return;
  }
  if (!response.ok) throw new Error(`Knowledge-map live request returned HTTP ${response.status}: ${payload.errorType || payload.error || 'unknown error'}.`);
  console.log(JSON.stringify({ ok: true, mode, origin, routePath, ...validateKnowledgeMapResponse(payload) }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
