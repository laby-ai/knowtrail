import assert from 'node:assert/strict';
import { searchAllSources } from '../src/lib/literature/service';

async function main() {
  const originalFetch = globalThis.fetch;
  process.env.LITERATURE_HMAC_SECRET = 'isolated-search-relevance-test-only-secret';
  globalThis.fetch = async () => new Response(JSON.stringify({ message: { items: [
    { DOI: '10.1234/accepted', title: ['Artificial intelligence supports sensor fusion'], 'published-online': { 'date-parts': [[2024]] }, author: [{ name: 'QA Author' }], abstract: 'A verified test fixture.', 'container-title': ['Topic journal'] },
    { DOI: '10.1234/partial', title: ['AI national policy'], abstract: 'Healthcare policy review', 'published-online': { 'date-parts': [[2024]] } },
    { DOI: '10.1234/venue-only', title: ['Unrelated soil chemistry'], abstract: 'Soil composition', 'container-title': ['AI fusion journal'], 'published-online': { 'date-parts': [[2024]] } },
    { DOI: '10.1234/undated', title: ['AI fusion in autonomous vehicles'], abstract: 'Multi-sensor data' },
  ] } }), { headers: { 'Content-Type': 'application/json' } });
  try {
    const results = await searchAllSources({ query: 'AI fusion', sources: ['crossref'], yearFrom: 2020, yearTo: 2025, userId: 'isolated-relevance-test' });
    assert.deepEqual(results.map(result => result.doi), ['10.1234/accepted']);
    assert.ok(results[0].resultId, 'Accepted real provider metadata must remain signed for ingestion');
    const doiResults = await searchAllSources({ query: 'https://doi.org/10.1234/accepted', sources: ['crossref'], userId: 'isolated-doi-test' });
    assert.deepEqual(doiResults.map(result => result.doi), ['10.1234/accepted']);
    console.log('Literature service relevance, year, DOI and signing checks passed');
  } finally { globalThis.fetch = originalFetch; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
