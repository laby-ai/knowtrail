import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DiscoverSearchProviderError,
  parseArxivAtom,
  searchDiscoveredSources,
} from '../src/lib/discover-search-provider';

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
const packageJson = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
assert.equal(
  packageJson.scripts?.['smoke:live-paper-search-provider'],
  'node ./scripts/smoke-live-paper-search-provider.mjs',
  'The production paper-search smoke must not depend on the dev-only tsx binary.',
);

console.log(JSON.stringify({
  ok: true,
  checked: [
    'arXiv Atom metadata and abstract become explicit open-source candidates',
    'scholar search falls back to arXiv when Metaso is not configured',
    'configured Metaso remains the preferred provider',
    'webpage search fails clearly instead of pretending arXiv covers the web',
    'discover route delegates to the tested provider abstraction',
    'paper-search UI explains the arXiv fallback and verification boundary',
    'production paper-search smoke runs with Node and production dependencies only',
  ],
}, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
