import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DiscoverSearchProviderError,
  parseArxivAtom,
  searchDiscoveredSources,
} from '../src/lib/discover-search-provider';
import { normalizeDiscoverQueryPlan, optimizeDiscoverQuery } from '../src/lib/discover-query-plan';
import { optimizePaperHostDiscoverQuery, parseGiiispPaperResponse, parsePaperHostSearchEvents, searchPaperHostSources } from '../src/lib/paper-host-discover-search';

const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <opensearch:totalResults>1</opensearch:totalResults>
  <entry>
    <id>https://arxiv.org/abs/2501.01234v2</id>
    <updated>2025-01-12T00:00:00Z</updated>
    <published>2025-01-10T00:00:00Z</published>
    <title>  Evidence-aware\n  multimodal evaluation  </title>
    <summary>We evaluate &amp; audit multimodal systems with traceable evidence.</summary>
    <author><name>Ada Researcher</name></author>
    <author><name>Lin Scholar</name></author>
    <link href="https://arxiv.org/abs/2501.01234v2" rel="alternate" type="text/html"/>
    <link href="https://arxiv.org/pdf/2501.01234v2" rel="related" type="application/pdf"/>
  </entry>
</feed>`;

async function main() {
const normalizedPlan = normalizeDiscoverQueryPlan(
  '多模态大模型',
  '```json\n{"optimizedQuery":"multimodal large language model evaluation 多模态大模型 评测","keywords":["MLLM","benchmark"]}\n```',
);
assert.equal(normalizedPlan.optimizedQuery, 'multimodal large language model evaluation 多模态大模型 评测');
assert.deepEqual(normalizedPlan.keywords, ['MLLM', 'benchmark']);

let planningPrompt = '';
const planned = await optimizeDiscoverQuery('多模态大模型如何评测？', 'scholar', async messages => {
  planningPrompt = String(messages[0]?.content || '');
  return '{"optimizedQuery":"multimodal large language model evaluation benchmark","keywords":["MLLM","evaluation"]}';
});
assert.equal(planned.optimizedQuery, 'multimodal large language model evaluation benchmark');
assert.match(planningPrompt, /不生成论文题名、作者、链接、引用或事实/);

const hostEvents = [
  'event: citation_source\ndata: {"index":1,"paper":{"title":"Grounded multimodal benchmark","description":"Evidence-aware evaluation.","url":"https://arxiv.org/abs/2501.01234","authors":["Ada Researcher"],"year":"2025","sourceApi":"/first/paper/searchArxiv"}}',
  'event: citation_source\ndata: {"index":2,"paper":{"title":"Grounded multimodal benchmark","url":"https://arxiv.org/abs/2501.01234"}}',
  'event: done\ndata: {"ok":true}',
].join('\n\n');
const parsedHost = parsePaperHostSearchEvents(hostEvents, 'scholar');
assert.equal(parsedHost.provider, 'giiisp-paper');
assert.equal(parsedHost.results.length, 1, 'The host parser must deduplicate real citation URLs.');
assert.deepEqual(parsedHost.results[0]?.authors, ['Ada Researcher']);

const giiispPapers = parseGiiispPaperResponse({
  code: 200,
  rows: [{
    arvixNo: '2501.01234v2',
    title: 'Grounded multimodal benchmark',
    author: 'Ada Researcher, Lin Scholar',
    paperAbstract: 'Evidence-aware evaluation.',
  }],
});
assert.equal(giiispPapers.provider, 'giiisp-paper');
assert.equal(giiispPapers.results[0]?.link, 'https://arxiv.org/abs/2501.01234v2');

const scholarRequests: Array<{ url: string; body: unknown }> = [];
const scholarSearch = await searchPaperHostSources({ query: 'multimodal benchmark', scope: 'scholar' }, {
  request: async request => {
    scholarRequests.push({ url: request.url, body: request.body });
    return { status: 200, text: '', json: { rows: [{ arvixNo: '2501.01234', title: 'Real paper' }] } };
  },
});
assert.equal(scholarSearch.results[0]?.title, 'Real paper');
assert.deepEqual(scholarRequests, [{
  url: '/first/paper/searchArxiv',
  body: { key: 'multimodal benchmark', pageNum: 1, pageSize: 10 },
}]);

const hostPlanRequests: unknown[] = [];
const hostPlan = await optimizePaperHostDiscoverQuery('多模态大模型如何评测？', 'scholar', {
  request: async request => {
    hostPlanRequests.push(request.body);
    return {
      status: 200,
      text: 'event: delta\ndata: {"content":"{\\"optimizedQuery\\":\\"multimodal large language model evaluation\\",\\"keywords\\":[\\"MLLM\\"]}"}\n\nevent: done\ndata: {"ok":true,"answer":"{\\"optimizedQuery\\":\\"multimodal large language model evaluation\\",\\"keywords\\":[\\"MLLM\\"]}"}\n\n',
    };
  },
});
assert.equal(hostPlan.optimizedQuery, 'multimodal large language model evaluation');
const hostPlanBody = hostPlanRequests[0] as Record<string, unknown>;
assert.deepEqual({
  mode: hostPlanBody.mode,
  scope: hostPlanBody.scope,
  enableWebSearch: hostPlanBody.enableWebSearch,
  enablePaperSearch: hostPlanBody.enablePaperSearch,
}, {
  mode: 'quick',
  scope: 'query-plan',
  enableWebSearch: false,
  enablePaperSearch: false,
});
assert.match(String(hostPlanBody.question), /不生成题名、作者、链接、引用或事实/);

const bridgeRequests: Array<{ body: unknown; timeout?: number }> = [];
const hostSearch = await searchPaperHostSources({ query: 'multimodal benchmark', scope: 'webpage' }, {
  request: async request => {
    bridgeRequests.push({ body: request.body });
    return {
      status: 200,
      text: 'event: citation_source\ndata: {"paper":{"title":"Reliable web source","description":"Primary documentation","url":"https://example.org/docs"}}\n\n',
    };
  },
});
assert.equal(hostSearch.provider, 'dashscope-web');
assert.equal(hostSearch.results[0]?.link, 'https://example.org/docs');
assert.deepEqual(bridgeRequests[0]?.body, {
  question: 'multimodal benchmark',
  mode: 'quick',
  scope: 'web',
  enableWebSearch: true,
  enablePaperSearch: false,
});

const parsed = parseArxivAtom(atom);
assert.equal(parsed.total, 1);
assert.deepEqual(parsed.results[0], {
  title: 'Evidence-aware multimodal evaluation',
  link: 'https://arxiv.org/abs/2501.01234v2',
  snippet: 'We evaluate & audit multimodal systems with traceable evidence.',
  content: 'We evaluate & audit multimodal systems with traceable evidence.',
  date: '2025-01-10',
  authors: ['Ada Researcher', 'Lin Scholar'],
  provider: 'arxiv',
  verificationStatus: 'open-source-candidate',
});

const arxivRequests: string[] = [];
const arxivResult = await searchDiscoveredSources({
  query: 'multimodal evaluation',
  scope: 'scholar',
  size: 5,
  withContent: false,
}, {
  metasoApiKey: '',
  fetchImpl: async input => {
    arxivRequests.push(String(input));
    return new Response(atom, { status: 200, headers: { 'Content-Type': 'application/atom+xml' } });
  },
});
assert.equal(arxivResult.provider, 'arxiv');
assert.equal(arxivResult.results[0]?.content, 'We evaluate & audit multimodal systems with traceable evidence.');
assert.match(arxivRequests[0] || '', /^https:\/\/export\.arxiv\.org\/api\/query\?/);
assert.match(arxivRequests[0] || '', /max_results=5/);

let retryCalls = 0;
const retriedArxiv = await searchDiscoveredSources({
  query: 'retryable scholar query',
  scope: 'scholar',
  size: 1,
  withContent: false,
}, {
  metasoApiKey: '',
  fetchImpl: async () => {
    retryCalls += 1;
    if (retryCalls === 1) throw new TypeError('temporary network reset');
    return new Response(atom, { status: 200, headers: { 'Content-Type': 'application/atom+xml' } });
  },
});
assert.equal(retryCalls, 2);
assert.equal(retriedArxiv.results.length, 1);

const metasoBodies: unknown[] = [];
const metasoResult = await searchDiscoveredSources({
  query: 'evidence synthesis',
  scope: 'scholar',
  size: 3,
  withContent: false,
}, {
  metasoApiBase: 'https://metaso.example/api/v1',
  metasoApiKey: 'configured-test-key',
  fetchImpl: async (_input, init) => {
    metasoBodies.push(JSON.parse(String(init?.body)));
    return Response.json({ scholars: [{ title: 'Metaso result', link: 'https://example.org/paper' }] });
  },
});
assert.equal(metasoResult.provider, 'metaso');
assert.deepEqual(metasoBodies, [{
  q: 'evidence synthesis',
  scope: 'scholar',
  includeSummary: false,
  size: '3',
  includeRawContent: false,
  conciseSnippet: true,
}]);

await assert.rejects(
  () => searchDiscoveredSources({ query: 'news', scope: 'webpage', size: 3, withContent: false }, {
    metasoApiKey: '',
    fetchImpl: async () => { throw new Error('must not call'); },
  }),
  (error: unknown) => error instanceof DiscoverSearchProviderError
    && error.status === 503
    && /学术/.test(error.message),
);

const routeSource = await readFile(path.join(process.cwd(), 'src/app/api/discover/search/route.ts'), 'utf8');
assert.match(routeSource, /searchDiscoveredSources/, 'Discover route must use the provider abstraction.');
const panelSource = await readFile(path.join(process.cwd(), 'src/components/library/DiscoverSourcesModal.tsx'), 'utf8');
assert.match(panelSource, /当前使用 arXiv 开放源/, 'The UI must explain the bounded open-source fallback.');
assert.match(panelSource, /可编辑检索式/, 'The UI must expose the model-refined query for user editing.');
assert.match(panelSource, /searchPaperHostSources/, 'The embedded UI must use the paper-web homepage search contract.');
const packageJson = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
assert.equal(
  packageJson.scripts?.['smoke:live-paper-search-provider'],
  'node ./scripts/smoke-live-paper-search-provider.mjs',
  'The production paper-search smoke must not depend on the dev-only tsx binary.',
);
const liveSmokeSource = await readFile(path.join(process.cwd(), 'scripts/smoke-live-paper-search-provider.mjs'), 'utf8');
assert.match(liveSmokeSource, /LIVE_PAPER_SEARCH_PATH/, 'The live smoke must support public and direct-candidate API paths.');

console.log(JSON.stringify({
  ok: true,
  checked: [
    'arXiv Atom metadata and abstract become explicit open-source candidates',
    'query planning only produces an editable search expression and cannot fabricate citations',
    'paper-host SSE parsing only exposes real citation_source records and deduplicates URLs',
    'embedded webpage and scholar search reuse the homepage grounded-search bridge',
    'scholar search falls back to arXiv when Metaso is not configured',
    'arXiv fallback retries one transient network failure without hiding persistent errors',
    'configured Metaso remains the preferred provider',
    'webpage search fails clearly instead of pretending arXiv covers the web',
    'discover route delegates to the tested provider abstraction',
    'paper-search UI explains the arXiv fallback and verification boundary',
    'production paper-search smoke runs with Node and production dependencies only',
    'live smoke supports both public base-path and direct candidate origins',
  ],
}, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
