import process from 'node:process';
import { searchDiscoveredSources } from '../src/lib/discover-search-provider';

const liveOrigin = (process.env.LIVE_PAPER_SEARCH_ORIGIN || 'https://airai.world').replace(/\/$/, '');
const query = (process.env.LIVE_PAPER_SEARCH_QUERY || 'multimodal large language model evaluation').trim();
const size = Math.min(5, Math.max(1, Number(process.env.LIVE_PAPER_SEARCH_SIZE) || 3));

async function main() {
  const result = await searchDiscoveredSources({
    query,
    scope: 'scholar',
    size,
    withContent: false,
  });
  if (result.results.length === 0) throw new Error('Live scholar provider returned no candidates.');
  if (result.results.some(item => !item.title || !item.snippet || !/^https?:\/\//.test(item.link))) {
    throw new Error('Live scholar provider returned an incomplete candidate.');
  }

  const accountGate = await fetch(`${liveOrigin}/lingbi/api/discover/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, scope: 'scholar', size: 1, withContent: false }),
    signal: AbortSignal.timeout(30_000),
  });
  const gateBody = await accountGate.json() as { errorType?: string };
  if (accountGate.status !== 401 || gateBody.errorType !== 'account_login_required') {
    throw new Error(`Production paper-search account gate drifted: HTTP ${accountGate.status}.`);
  }

  console.log(JSON.stringify({
    ok: true,
    liveOrigin,
    provider: result.provider,
    query,
    candidateCount: result.results.length,
    candidates: result.results.map(item => ({
      hasTitle: Boolean(item.title),
      hasAbstract: Boolean(item.snippet),
      hasAuthors: item.authors.length > 0,
      date: item.date || null,
      host: new URL(item.link).hostname,
      verificationStatus: item.verificationStatus,
    })),
    productionAccountGate: { status: accountGate.status, errorType: gateBody.errorType },
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
