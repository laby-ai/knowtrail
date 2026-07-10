import process from 'node:process';
import { XMLParser } from 'fast-xml-parser';

const liveOrigin = (process.env.LIVE_PAPER_SEARCH_ORIGIN || 'https://airai.world').replace(/\/$/, '');
const query = (process.env.LIVE_PAPER_SEARCH_QUERY || 'multimodal large language model evaluation').trim();
const size = Math.min(5, Math.max(1, Number(process.env.LIVE_PAPER_SEARCH_SIZE) || 3));

function array(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function valueText(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).replace(/\s+/g, ' ').trim();
  if (value && typeof value === 'object' && '#text' in value) return valueText(value['#text']);
  return '';
}

async function probeProvider() {
  const metasoApiKey = process.env.METASO_API_KEY?.trim() || '';
  if (metasoApiKey) {
    const base = (process.env.METASO_API_BASE?.trim() || 'https://metaso.cn/api/v1').replace(/\/$/, '');
    const response = await fetch(`${base}/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${metasoApiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, scope: 'scholar', includeSummary: false, size: String(size), includeRawContent: false, conciseSnippet: true }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Metaso live probe returned HTTP ${response.status}.`);
    const payload = await response.json();
    const candidates = payload.scholars || payload.papers || payload.documents || payload.webpages || [];
    return {
      provider: 'metaso',
      candidates: candidates.map(item => ({
        hasTitle: Boolean(valueText(item.title)),
        hasAbstract: Boolean(valueText(item.snippet) || valueText(item.content)),
        hasAuthors: array(item.authors).some(valueText),
        date: valueText(item.date) || null,
        host: valueText(item.link) ? new URL(valueText(item.link)).hostname : null,
        verificationStatus: 'candidate',
      })),
    };
  }

  const base = process.env.ARXIV_API_BASE?.trim() || 'https://export.arxiv.org';
  const url = new URL('/api/query', base);
  url.searchParams.set('search_query', `all:"${query.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()}"`);
  url.searchParams.set('start', '0');
  url.searchParams.set('max_results', String(size));
  url.searchParams.set('sortBy', 'relevance');
  url.searchParams.set('sortOrder', 'descending');
  const response = await fetch(url, {
    headers: { Accept: 'application/atom+xml', 'User-Agent': 'KnowTrail/1.0 (https://airai.world)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`arXiv live probe returned HTTP ${response.status}.`);
  const payload = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', trimValues: true }).parse(await response.text());
  const entries = array(payload?.feed?.entry);
  return {
    provider: 'arxiv',
    candidates: entries.map(entry => {
      const links = array(entry.link);
      const alternate = links.find(link => valueText(link.rel) === 'alternate') || links.find(link => valueText(link.type) === 'text/html');
      const link = valueText(alternate?.href) || valueText(entry.id);
      return {
        hasTitle: Boolean(valueText(entry.title)),
        hasAbstract: Boolean(valueText(entry.summary)),
        hasAuthors: array(entry.author).some(author => valueText(author?.name)),
        date: valueText(entry.published).slice(0, 10) || null,
        host: link ? new URL(link).hostname : null,
        verificationStatus: 'open-source-candidate',
      };
    }),
  };
}

async function main() {
  const result = await probeProvider();
  if (result.candidates.length === 0) throw new Error('Live scholar provider returned no candidates.');
  if (result.candidates.some(item => !item.hasTitle || !item.hasAbstract || !item.host)) {
    throw new Error('Live scholar provider returned an incomplete candidate.');
  }

  const accountGate = await fetch(`${liveOrigin}/lingbi/api/discover/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, scope: 'scholar', size: 1, withContent: false }),
    signal: AbortSignal.timeout(30_000),
  });
  const gateBody = await accountGate.json();
  if (accountGate.status !== 401 || gateBody.errorType !== 'account_login_required') {
    throw new Error(`Production paper-search account gate drifted: HTTP ${accountGate.status}.`);
  }

  console.log(JSON.stringify({
    ok: true,
    liveOrigin,
    provider: result.provider,
    query,
    candidateCount: result.candidates.length,
    candidates: result.candidates,
    productionAccountGate: { status: accountGate.status, errorType: gateBody.errorType },
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
