import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/discover/search/route';

async function main() {
  const originalFetch = globalThis.fetch;
  const previous = { key: process.env.METASO_API_KEY, base: process.env.METASO_API_BASE, auth: process.env.ACCOUNT_CENTER_REQUIRE_AUTH };
  let providerCalls = 0;
  process.env.METASO_API_KEY = 'local-test-only';
  process.env.METASO_API_BASE = 'https://discover-test.invalid';
  process.env.ACCOUNT_CENTER_REQUIRE_AUTH = 'false';
  globalThis.fetch = async input => {
    assert.equal(String(input), 'https://discover-test.invalid/search');
    providerCalls += 1;
    return Response.json({ webpages: [
      { title: 'Quantum sensor calibration', snippet: 'Quantum sensor calibration methods', link: 'https://example.com/relevant' },
      { title: 'Cooking recipes', snippet: 'Bread and cake recipes', link: 'https://example.com/unrelated' },
    ], total: 2 });
  };
  const request = (query: string) => new NextRequest('http://localhost/api/discover/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, scope: 'webpage', notebookId: 'relevance-test' }),
  });
  try {
    const response = await POST(request('quantum sensor calibration'));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.results.length, 1);
    assert.equal(data.results[0].link, 'https://example.com/relevant');
    assert.equal(data.results[0].relevance.verdict, 'relevant');
    assert.equal(data.results[0].sourceCategory, 'webpage');
    assert.equal(data.relevanceStage.totalCount, 2);
    assert.equal(data.relevanceStage.irrelevantCount, 1);
    const allRejected = await (await POST(request('zebra migration'))).json();
    assert.equal(allRejected.relevanceStage.status, 'all-irrelevant');
    assert.equal(allRejected.results.length, 0);
    const unassessed = await (await POST(request('a'))).json();
    assert.equal(unassessed.relevanceStage.status, 'no-query-terms');
    assert.equal(unassessed.results.length, 2);
    assert.equal(unassessed.results[0].relevance.verdict, 'unassessed');
    assert.equal((await POST(request('   '))).status, 400);
    process.env.ACCOUNT_CENTER_REQUIRE_AUTH = 'true';
    assert.equal((await POST(request('quantum sensor calibration'))).status, 401);
    assert.equal(providerCalls, 3, 'Empty and unauthorized requests must not call a provider');
    console.log('PASS: search route filters results, reports counts, preserves unassessed candidates and enforces auth');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries({METASO_API_KEY: previous.key, METASO_API_BASE: previous.base, ACCOUNT_CENTER_REQUIRE_AUTH: previous.auth})) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });