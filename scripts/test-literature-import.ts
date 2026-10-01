import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mock } from 'node:test';
import dns from 'node:dns/promises';
import https from 'node:https';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/literature/import/route';
import {
  buildSourceStoreFromPostgresRows,
  getIngestionSource,
  importLiteratureSource as importLiteratureSourceWithFullText,
  listIngestionSources,
  listReadySourceChunks,
  sourceStoreStatus,
} from '../src/lib/ingestion-store';
import type { AccountAuthContext } from '../src/lib/account-auth-client';
import {
  literatureEntryKey,
  literatureIdentityKey,
  sameLiteratureEntry,
  sameLiteraturePaper,
} from '../src/lib/literature/library';
import {
  literatureText,
  MAX_LITERATURE_RESULT_TOKEN_LENGTH,
  signLiteratureResult,
  verifyLiteratureResult,
} from '../src/lib/literature/result-token';
import { searchAllSources } from '../src/lib/literature/service';
import { LITERATURE_PROVIDER_IDS, type LiteratureMetadata, type LiteratureFullTextStatus, type FullTextFailureCode } from '../src/lib/literature/types';
import { FullTextError } from '../src/lib/literature/fulltext';
import { buildSourceChunks } from '../src/lib/rag';
import { LocalJsonSourceStoreAdapter } from '../src/lib/source-store/local-json-adapter';
import type { StoredSourceRecord } from '../src/lib/source-store/types';

const unavailableFullText = async () => { throw new FullTextError('no_oa', '该论文暂无开放获取全文'); };
const importLiteratureSource: typeof importLiteratureSourceWithFullText = (paper, scope, options) =>
  importLiteratureSourceWithFullText(paper, scope, { fetchFullText: unavailableFullText, ...options });

type ImportResponse = { success: true; alreadyExists: boolean; source: StoredSourceRecord; fullText: LiteratureFullTextStatus };

const paper: LiteratureMetadata = {
  title: 'Reliable evidence for literature libraries',
  authors: [{ name: 'Ada Lovelace' }, { name: 'Grace Hopper' }],
  year: 2025,
  doi: '10.1234/Example.Paper',
  arxivId: '2501.01234v2',
  abstract: 'The abstract contains the only available evidence, not a full-text article.',
  venue: 'Journal of Reliable Evidence',
  url: 'https://example.org/paper',
  source: 'crossref',
  provider: 'Crossref',
  evidenceScope: 'abstract',
  retrievedAt: '2026-09-16T00:00:00.000Z',
};
const scope = { ownerMemberId: 'member-a', notebookId: 'notebook-a' };
const apiScope = { ownerMemberId: 'api-member-a', notebookId: 'api-notebook-a' };
const sparseScope = { ...scope, notebookId: 'sparse-notebook' };
const sessionA = 'isolated-session-a';
const sessionB = 'isolated-session-b';
const sparsePaper: LiteratureMetadata = {
  ...paper, doi: undefined, arxivId: undefined, authors: [], year: '',
};
const sparseRediscovered: LiteratureMetadata = {
  ...sparsePaper, source: 'openalex', provider: 'OpenAlex',
  retrievedAt: '2026-09-18T00:00:00.000Z', evidenceScope: 'fulltext',
  abstract: ` \n${sparsePaper.abstract}\t `,
};

function signedRaw(value: unknown): string {
  const json = JSON.stringify(value);
  const hmac = createHmac('sha256', process.env.LITERATURE_HMAC_SECRET!).update(json).digest('hex');
  return `${Buffer.from(json).toString('base64url')}.${hmac}`;
}

async function main() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'literature-import-test-'));
  const envPatch = {
    SOURCE_STORE_ADAPTER: 'local-json',
    SOURCE_STORE_PATH: path.join(tmpDir, 'sources.json'),
    LITERATURE_HMAC_SECRET: 'isolated-literature-import-test-secret',
    ACCOUNT_CENTER_REQUIRE_AUTH: 'false',
    ACCOUNT_CENTER_API_BASE: 'https://literature-import-auth.invalid',
    SCITE_API_KEY: 'isolated-provider-fixture-key',
  };
  const previousEnv = new Map(Object.keys(envPatch).map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  const authUrl = `${envPatch.ACCOUNT_CENTER_API_BASE}/v1/auth/me`;
  const authCalls: string[] = [];
  const unexpectedFetchCalls: string[] = [];
  const expectedAuthCalls: string[] = [];
  const apiStatuses = new Map<number, number>();
  let passed = 0;
  Object.assign(process.env, envPatch);
  const dnsMock = mock.method(dns, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
  const httpsMock = mock.method(https, 'request', (input: string | URL | https.RequestOptions) => {
    const hostname = typeof input === 'string' ? new URL(input).hostname
      : input instanceof URL ? input.hostname : input.hostname;
    if (!['api.unpaywall.org', 'arxiv.org'].includes(String(hostname))) {
      unexpectedFetchCalls.push(`https:${hostname}`);
    }
    throw new FullTextError('no_oa', '离线模拟：暂无可获取的开放全文');
  });
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).hostname === 'api.unpaywall.org') {
      return Response.json({ is_oa: false, best_oa_location: null, oa_locations: [] });
    }
    if (url !== authUrl) {
      unexpectedFetchCalls.push(url);
      throw new Error('Unexpected non-fixture network request');
    }
    const request = new Request(input, init);
    const authorization = request.headers.get('authorization') || '';
    // Retain unexpected calls even if production code catches the stub's error.
    if (request.url !== authUrl || request.method !== 'GET' || request.cache !== 'no-store'
      || !authorization.startsWith('Bearer ') || request.body !== null) {
      unexpectedFetchCalls.push(`${request.method} ${request.url}`);
      throw new Error('Only the real account auth/me contract may use fetch; no downloads or embeddings');
    }
    authCalls.push(authorization);
    const memberId = authorization === `Bearer ${sessionA}` ? apiScope.ownerMemberId
      : authorization === `Bearer ${sessionB}` ? 'api-member-b' : undefined;
    if (!memberId) return Response.json({ error: 'invalid_session' }, { status: 401 });
    const context: AccountAuthContext = {
      tenant_id: 'isolated-test-tenant', tenant_name: 'Isolated test tenant',
      member: {
        id: memberId, display_name: 'Test member', email: `${memberId}@example.invalid`,
        role_key: 'member', status: 'active',
      },
    };
    return Response.json(context);
  };
  function assertFetchBoundary() {
    assert.deepEqual(unexpectedFetchCalls, [], 'Only auth and controlled OA fixtures are allowed; no real downloads or embeddings');
    assert.deepEqual([...authCalls].sort(), [...expectedAuthCalls].sort(), 'Exactly one auth/me call per bearer request');
  }
  async function check(label: string, run: () => void | Promise<void>) {
    await run();
    assertFetchBoundary();
    passed += 1;
    console.log(`PASS ${label}`);
  }
  async function apiRequest(body: unknown, options: { token?: string | null; raw?: boolean } = {}) {
    const token = options.token === undefined ? sessionA : options.token;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token !== null) {
      headers.authorization = `Bearer ${token}`;
      if (token.trim()) expectedAuthCalls.push(`Bearer ${token.trim()}`);
    }
    const response = await POST(new NextRequest('http://localhost/api/literature/import', {
      method: 'POST', headers,
      body: options.raw ? String(body) : JSON.stringify(body),
    }));
    apiStatuses.set(response.status, (apiStatuses.get(response.status) || 0) + 1);
    return response;
  }
  async function readSuccess(response: Response, status: 200 | 201): Promise<ImportResponse> {
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body: unknown = await response.json();
    assert(body && typeof body === 'object');
    assert('success' in body && body.success === true);
    assert('alreadyExists' in body && body.alreadyExists === (status === 200));
    assert('source' in body && body.source && typeof body.source === 'object');
    assert(!('error' in body));
    const result = body as ImportResponse;
    assert.equal(result.source.status, 'succeeded');
    assert.equal(result.source.vectorIndex.status, 'not_configured');
    assert.equal(result.source.storageKey, undefined);
    assert.equal(result.source.fileUrl, undefined);
    return result;
  }
  async function readError(response: Response, status: 400 | 401 | 500) {
    assert.equal(response.status, status);
    const body: unknown = await response.json();
    assert(body && typeof body === 'object');
    assert('error' in body && typeof body.error === 'string' && body.error.trim());
    for (const field of ['success', 'source', 'alreadyExists']) assert(!(field in body));
  }

  try {
    await check('signed token roundtrip and safe original-link display', () => {
      const verified = verifyLiteratureResult(signLiteratureResult(paper));
      assert(verified);
      assert.equal(verified.doi, paper.doi);
      assert.equal(verified.source, paper.source);
      assert.match(literatureText(verified), /原文链接.*https:\/\/example.org\/paper/);
      assert.doesNotMatch(literatureText({ ...verified, url: 'javascript:alert(1)' }), /原文链接/);
    });

    await check('invalid token shapes, signatures and oversized tokens return null', () => {
      const token = signLiteratureResult(paper);
      const payload = token.split('.')[0];
      for (const invalid of ['', 'x', '.', 'x.y', `${payload}.a`, `${payload}.${'0'.repeat(66)}`,
        `${payload}.${'0'.repeat(64)}`, `${payload}.`, `!.${'0'.repeat(64)}`,
        'x'.repeat(MAX_LITERATURE_RESULT_TOKEN_LENGTH + 1),
        `${Buffer.from('{').toString('base64url')}.${'0'.repeat(64)}`]) {
        assert.doesNotThrow(() => assert.equal(verifyLiteratureResult(invalid), null));
      }
    });

    await check('valid HMAC still requires valid metadata schema', () => {
      const invalidValues: unknown[] = [null, [], {},
        { ...paper, title: '  ' }, { ...paper, source: 'unknown-provider' },
        { ...paper, authors: 'Ada' }, { ...paper, authors: [{ name: '' }] },
        { ...paper, year: {} }, { ...paper, year: -1 }, { ...paper, year: 'not-a-year' },
        { ...paper, retrievedAt: 'yesterday' }, { ...paper, evidenceScope: 'fabricated' },
        { ...paper, url: 'javascript:alert(1)' }, { ...paper, url: 'file:///private' },
        { ...paper, abstract: null },
      ];
      for (const invalid of invalidValues) assert.equal(verifyLiteratureResult(signedRaw(invalid)), null);
      assert(verifyLiteratureResult(signedRaw({ ...paper, authors: [], year: '', url: '' })));
    });

    await check('DOI priority, arXiv version normalization and conservative fallback', () => {
      assert.equal(literatureIdentityKey(paper), 'doi:10.1234/example.paper');
      assert(sameLiteraturePaper(paper, { ...paper, doi: 'https://doi.org/10.1234/example.paper' }));
      assert(!sameLiteraturePaper(paper, { ...paper, doi: '10.1234/different' }));
      assert(sameLiteraturePaper({ ...paper, doi: undefined }, { ...paper, doi: undefined, arxivId: 'https://arxiv.org/pdf/2501.01234v9.pdf' }));
      assert.equal(literatureIdentityKey({ ...paper, doi: undefined, arxivId: 'arXiv:math.GT/0309136v2' }), 'arxiv:math.gt/0309136');
      const metadata = { ...paper, doi: undefined, arxivId: undefined };
      assert(sameLiteraturePaper(metadata, { ...metadata, title: metadata.title.toUpperCase(), year: '2025' }));
      assert(!sameLiteraturePaper(metadata, { ...metadata, authors: [{ name: 'Other Author' }] }));
      assert(!sameLiteraturePaper(metadata, { ...metadata, year: 2024 }));
      assert(!sameLiteraturePaper(metadata, paper));
      assert.equal(literatureIdentityKey({ ...metadata, authors: [] }), '');
      assert(!sameLiteraturePaper({ ...metadata, authors: [] }, { ...metadata, authors: [] }));
    });

    await check('sparse entry equality ignores retrieval context but never infers paper identity', () => {
      assert.equal(literatureIdentityKey(sparsePaper), '');
      assert.equal(literatureIdentityKey(sparseRediscovered), '');
      assert(!sameLiteraturePaper(sparsePaper, sparsePaper));
      assert(!sameLiteraturePaper(sparsePaper, sparseRediscovered));
      assert(literatureEntryKey(sparsePaper));
      assert.equal(literatureEntryKey(sparsePaper), literatureEntryKey(sparseRediscovered));
      assert(sameLiteratureEntry(sparsePaper, sparseRediscovered));
      assert(sameLiteratureEntry(sparseRediscovered, sparsePaper));
      const identified = { ...sparsePaper, doi: paper.doi };
      assert.equal(literatureEntryKey(identified), literatureIdentityKey(identified));
      assert(!sameLiteratureEntry(sparsePaper, identified));
      assert(!sameLiteratureEntry(identified, sparsePaper));
    });

    await check('sparse entry equality requires all bibliographic content, not just a title', () => {
      const differentEntries: LiteratureMetadata[] = [
        { ...sparsePaper, url: `${sparsePaper.url}/different` },
        { ...sparsePaper, abstract: `${sparsePaper.abstract} Different evidence.` },
        { ...sparsePaper, venue: 'Different journal' },
        { ...sparsePaper, title: `${sparsePaper.title} (different)` },
        { ...sparsePaper, authors: [{ name: 'Known author' }] },
        { ...sparsePaper, year: 2024 },
      ];
      for (const different of differentEntries) {
        assert.equal(literatureIdentityKey(different), '');
        assert.notEqual(literatureEntryKey(sparsePaper), literatureEntryKey(different));
        assert(!sameLiteratureEntry(sparsePaper, different));
        assert(!sameLiteratureEntry(different, sparsePaper));
      }
    });

    await check('identified entries preserve DOI conflicts and cross-identifier paper matching', () => {
      const variants: LiteratureMetadata[] = [
        { ...paper, doi: 'https://doi.org/10.1234/example.paper' },
        { ...paper, doi: '10.1234/conflicting' },
        { ...paper, doi: undefined, arxivId: '2501.01234v9' },
        { ...paper, doi: undefined, arxivId: undefined },
      ];
      for (const variant of variants) {
        assert(literatureIdentityKey(variant));
        assert.equal(literatureEntryKey(variant), literatureIdentityKey(variant));
        assert.equal(sameLiteratureEntry(paper, variant), sameLiteraturePaper(paper, variant));
        assert.equal(sameLiteratureEntry(variant, paper), sameLiteraturePaper(variant, paper));
      }
      assert(!sameLiteratureEntry(paper, variants[1]));
      assert(sameLiteratureEntry(paper, variants[2]));
    });

    await check('abstract import creates real successful source and abstract-only chunks', async () => {
      assert.equal(sourceStoreStatus().provider, 'local-json');
      const imported = await importLiteratureSource(paper, scope);
      assert.equal(imported.alreadyExists, false);
      assert.match(imported.source.id, /^lit-[a-f0-9]{64}$/);
      assert.equal(imported.source.status, 'succeeded');
      assert.equal(imported.source.ownerMemberId, scope.ownerMemberId);
      assert.equal(imported.source.notebookId, scope.notebookId);
      assert.deepEqual(imported.source.literature, paper);
      assert(imported.source.chunkCount > 0);
      assert.equal(imported.source.vectorIndex.status, 'not_configured');
      assert(imported.source.chunks.every(chunk => chunk.sourceId === imported.source.id));
      const chunkText = imported.source.chunks.map(chunk => chunk.text).join('\n');
      assert(chunkText.includes(paper.abstract));
      assert(!chunkText.includes(paper.url));
      assert(!chunkText.includes(paper.venue));
      assert.equal(imported.source.storageKey, undefined);
      assert.equal(imported.source.fileUrl, undefined);
    });

    await check('disk read and fresh JSON adapter restore real metadata', async () => {
      assert((await readFile(envPatch.SOURCE_STORE_PATH, 'utf8')).includes(paper.venue));
      const restored = await new LocalJsonSourceStoreAdapter().read();
      assert.equal(restored.sources.length, 1);
      assert.deepEqual(restored.sources[0].literature, paper);
      const source = await getIngestionSource(restored.sources[0].id, scope);
      assert.deepEqual(source?.literature, paper);
      assert.equal(await getIngestionSource(restored.sources[0].id, { ...scope, ownerMemberId: 'other' }), undefined);
    });

    await check('cross-provider same-DOI duplicate keeps original record unchanged', async () => {
      const original = (await listIngestionSources(scope))[0];
      const duplicate = await importLiteratureSource({
        ...paper, doi: 'https://doi.org/10.1234/example.paper', source: 'openalex', provider: 'OpenAlex',
        title: 'Changed provider title', abstract: 'Replacement must not overwrite prior evidence.',
        retrievedAt: '2026-09-17T00:00:00.000Z',
      }, scope);
      assert.equal(duplicate.alreadyExists, true);
      assert.deepEqual(duplicate.source, original);
      assert.equal((await listIngestionSources(scope)).length, 1);
    });

    await check('concurrent duplicate imports insert exactly one new record', async () => {
      const concurrentPaper = { ...paper, doi: '10.1234/concurrent', arxivId: undefined };
      const results = await Promise.all(Array.from({ length: 16 }, () => importLiteratureSource(concurrentPaper, scope)));
      assert.equal(results.filter(result => !result.alreadyExists).length, 1);
      assert.equal(new Set(results.map(result => result.source.id)).size, 1);
      assert.equal((await listIngestionSources(scope)).length, 2);
    });

    await check('identical titles with different DOIs stay separate', async () => {
      const imported = await importLiteratureSource({ ...paper, doi: '10.1234/different' }, scope);
      assert.equal(imported.alreadyExists, false);
      assert.equal((await listIngestionSources(scope)).length, 3);
    });

    await check('account and notebook scopes are fully isolated', async () => {
      const original = (await listIngestionSources(scope))[0];
      const otherAccount = await importLiteratureSource(paper, { ...scope, ownerMemberId: 'member-b' });
      const otherNotebook = await importLiteratureSource(paper, { ...scope, notebookId: 'notebook-b' });
      assert.equal(otherAccount.alreadyExists, false);
      assert.equal(otherNotebook.alreadyExists, false);
      assert.equal(new Set([original.id, otherAccount.source.id, otherNotebook.source.id]).size, 3);
      assert.equal((await listIngestionSources({ ...scope, ownerMemberId: 'member-b' })).length, 1);
      assert.equal((await listIngestionSources({ ...scope, notebookId: 'notebook-b' })).length, 1);
      await assert.rejects(importLiteratureSource(paper, { ...scope, ownerMemberId: '' }));
      await assert.rejects(importLiteratureSource(paper, { ...scope, notebookId: '' }));
      await assert.rejects(importLiteratureSource(paper, { ...scope, notebookId: '../invalid' }));
    });

    await check('missing account or notebook cannot list, read or retrieve literature', async () => {
      const original = (await listIngestionSources(scope))[0];
      assert(original);
      for (const incompleteScope of [{}, { ownerMemberId: scope.ownerMemberId }, { notebookId: scope.notebookId }]) {
        assert.deepEqual(await listIngestionSources(incompleteScope), []);
        assert.equal(await getIngestionSource(original.id, incompleteScope), undefined);
        assert.deepEqual((await listReadySourceChunks({ ...incompleteScope, identities: [original.id] })).chunks, []);
      }
    });

    await check('metadata-only import succeeds with zero chunks and no invented full text', async () => {
      const metadata = { ...paper, doi: '10.1234/metadata', abstract: ' \n\t ', evidenceScope: 'fulltext' as const,
        fullText: 'CLIENT CLAIMED FULLTEXT', oaLocations: [{ url: 'https://example.org/download', source: 'test' }] };
      const imported = await importLiteratureSource(metadata, scope);
      assert.equal(imported.source.status, 'succeeded');
      assert.equal(imported.source.literature?.evidenceScope, 'metadata');
      assert.equal(imported.source.literature?.abstract, '');
      assert.equal(imported.source.chunkCount, 0);
      assert.equal(imported.source.tokenEstimate, 0);
      assert.deepEqual(imported.source.chunks, []);
      assert(!('fullText' in imported.source.literature!));
      assert(!('oaLocations' in imported.source.literature!));
      assert.equal((await listReadySourceChunks({ ...scope, identities: [imported.source.id] })).chunks.length, 0);
      const restored = await getIngestionSource(imported.source.id, scope);
      assert.equal(restored?.literature?.evidenceScope, 'metadata');
      assert.deepEqual(restored?.chunks, []);
    });

    await check('actual abstract determines evidence scope, not fulltext claims', async () => {
      const imported = await importLiteratureSource({ ...paper, doi: '10.1234/scope', evidenceScope: 'fulltext' }, scope);
      assert.equal(imported.source.literature?.evidenceScope, 'abstract');
      assert(imported.source.chunkCount > 0);
    });

    await check('identifier-free metadata deduplicates only with matching authors and year', async () => {
      const metadata = { ...paper, doi: undefined, arxivId: undefined, abstract: '' };
      const first = await importLiteratureSource(metadata, scope);
      const second = await importLiteratureSource({ ...metadata, source: 'pubmed', provider: 'PubMed' }, scope);
      assert.equal(second.alreadyExists, true);
      assert.equal(first.source.id, second.source.id);
      const differentYear = await importLiteratureSource({ ...metadata, year: 2023 }, scope);
      assert.equal(differentYear.alreadyExists, false);
    });

    await check('sparse exact entries deduplicate across search times and providers without replacement', async () => {
      const first = await importLiteratureSource(sparsePaper, sparseScope);
      const second = await importLiteratureSource(sparseRediscovered, sparseScope);
      assert.equal(first.alreadyExists, false);
      assert.equal(second.alreadyExists, true);
      assert.deepEqual(second.source, JSON.parse(JSON.stringify(first.source)));
      assert.equal((await listIngestionSources(sparseScope)).length, 1);
      const restored = (await new LocalJsonSourceStoreAdapter().read()).sources.filter(source => (
        source.ownerMemberId === sparseScope.ownerMemberId && source.notebookId === sparseScope.notebookId
      ));
      assert.equal(restored.length, 1);
      assert.equal(restored[0].id, first.source.id);
      assert.deepEqual(restored[0].literature, JSON.parse(JSON.stringify(sparsePaper)));
    });

    await check('16 concurrent sparse store imports create one record and 15 duplicates', async () => {
      const concurrentScope = { ...sparseScope, notebookId: 'sparse-concurrent' };
      const results = await Promise.all(Array.from({ length: 16 }, (_, index) => importLiteratureSource({
        ...(index % 2 ? sparseRediscovered : sparsePaper),
        retrievedAt: new Date(Date.UTC(2026, 8, 1, 0, 0, index)).toISOString(),
      }, concurrentScope)));
      assert.equal(results.filter(result => !result.alreadyExists).length, 1);
      assert.equal(results.filter(result => result.alreadyExists).length, 15);
      assert.equal(new Set(results.map(result => result.source.id)).size, 1);
      assert.equal((await listIngestionSources(concurrentScope)).length, 1);
      const fresh = (await new LocalJsonSourceStoreAdapter().read()).sources.filter(source => (
        source.ownerMemberId === concurrentScope.ownerMemberId && source.notebookId === concurrentScope.notebookId
      ));
      assert.equal(fresh.length, 1);
      assert.equal(fresh[0].id, results[0].source.id);
    });

    await check('same sparse title with different URL or abstract persists separately', async () => {
      const differentUrl = await importLiteratureSource({ ...sparsePaper, url: `${sparsePaper.url}/other` }, sparseScope);
      const differentAbstract = await importLiteratureSource({ ...sparsePaper, abstract: 'Different abstract evidence.' }, sparseScope);
      assert.equal(differentUrl.alreadyExists, false);
      assert.equal(differentAbstract.alreadyExists, false);
      const sources = await listIngestionSources(sparseScope);
      assert.equal(sources.length, 3);
      assert.equal(new Set(sources.map(source => source.id)).size, 3);
      assert(sources.every(source => source.title === sparsePaper.title));
      assert(sources.some(source => source.literature?.url === `${sparsePaper.url}/other`));
      assert(sources.some(source => source.literature?.abstract === 'Different abstract evidence.'));
    });

    await check('Postgres payload serialization and row reconstruction preserve metadata (no live PG)', async () => {
      const sources = [...await listIngestionSources(scope), ...await listIngestionSources(sparseScope)];
      for (const serialized of [false, true]) {
        const restored = buildSourceStoreFromPostgresRows({
          sources: sources.map(source => ({
            id: source.id, file_name: source.fileName, file_type: source.fileType,
            title: source.title, short_name: source.shortName, status: source.status,
            vector_status: source.vectorIndex.status, created_at: source.createdAt, updated_at: source.updatedAt,
            payload: serialized ? JSON.stringify(source) : JSON.parse(JSON.stringify(source)),
          })),
          chunks: [], stages: [],
        });
        assert.equal(restored.sources.length, sources.length);
        for (const source of sources) {
          const record = restored.sources.find(item => item.id === source.id);
          assert.deepEqual(record?.literature, JSON.parse(JSON.stringify(source.literature)));
          assert.deepEqual(record?.chunks, source.chunks);
          assert.equal(record?.ownerMemberId, source.ownerMemberId);
          assert.equal(record?.notebookId, source.notebookId);
        }
      }
    });

    await check('all seven provider fixtures preserve unknown dates and yield importable signed results', async () => {
      const authFetch = globalThis.fetch;
      const fixtureScope = { ...scope, notebookId: 'provider-fixtures' };
      let fixtureRequests = 0;
      globalThis.fetch = async input => {
        fixtureRequests += 1;
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.hostname === 'api.crossref.org') return Response.json({ message: { items: [{ title: ['Crossref unknown date'], author: [{}] }] } });
        if (url.hostname === 'www.ebi.ac.uk') return Response.json({ resultList: { result: [{ title: 'Europe PMC unknown date', authorList: { author: [{}] }, id: '123' }] } });
        if (url.hostname === 'api.semanticscholar.org') return Response.json({ data: [{ title: 'Semantic Scholar unknown date', authors: [{ name: ' ' }] }] });
        if (url.hostname === 'api.openalex.org') return Response.json({ results: [{ title: 'OpenAlex unknown date', authorships: [{ author: { display_name: '' } }] }] });
        if (url.hostname === 'export.arxiv.org') return new Response('<feed><entry><title>arXiv unknown date</title><id>https://arxiv.org/abs/2501.01234</id><author><name> </name></author></entry></feed>');
        if (url.hostname === 'eutils.ncbi.nlm.nih.gov' && url.pathname.endsWith('/esearch.fcgi')) return Response.json({ esearchresult: { idlist: ['123'] } });
        if (url.hostname === 'eutils.ncbi.nlm.nih.gov' && url.pathname.endsWith('/esummary.fcgi')) return Response.json({ result: { '123': { title: 'PubMed unknown date', authors: [{}] } } });
        if (url.hostname === 'api.scite.ai') return Response.json({ citations: [{ title: 'Scite unknown date', authors: ' ' }] });
        throw new Error(`Unexpected fixture request: ${url.hostname}${url.pathname}`);
      };
      try {
        for (const source of LITERATURE_PROVIDER_IDS) {
          const results = await searchAllSources({ query: 'unknown dates', sources: [source], limitPerSource: 1, userId: `fixture-${source}` });
          assert.equal(results.length, 1, source);
          assert.equal(results[0].year, '', source);
          assert.deepEqual(results[0].authors, [], source);
          const metadata = verifyLiteratureResult(results[0].resultId);
          assert(metadata, source);
          const imported = await importLiteratureSource(metadata, fixtureScope);
          assert.equal(imported.source.literature?.year, '');
          assert.equal(imported.source.literature?.evidenceScope, 'metadata');
          assert.equal(imported.source.chunkCount, 0);
        }
        assert.equal(fixtureRequests, 8);
        assert.equal((await listIngestionSources(fixtureScope)).length, 7);
      } finally {
        globalThis.fetch = authFetch;
      }
    });

    const apiBody = { resultToken: signedRaw(paper), notebookId: apiScope.notebookId };
    async function rejectBadBodies(bodies: unknown[]) {
      const before = await readFile(envPatch.SOURCE_STORE_PATH, 'utf8');
      for (const body of bodies) await readError(await apiRequest(body), 400);
      assert.equal(await readFile(envPatch.SOURCE_STORE_PATH, 'utf8'), before, 'Rejected requests must not mutate any scope');
    }

    await check('API requires session even when optional-auth configuration is disabled', async () => {
      const before = await readFile(envPatch.SOURCE_STORE_PATH, 'utf8');
      await readError(await apiRequest(apiBody, { token: null }), 401);
      await readError(await apiRequest(apiBody, { token: '' }), 401);
      assert.equal(authCalls.length, 0);
      assert.equal(await readFile(envPatch.SOURCE_STORE_PATH, 'utf8'), before);
    });

    await check('API rejects an invalid bearer session without saving', async () => {
      const before = await readFile(envPatch.SOURCE_STORE_PATH, 'utf8');
      await readError(await apiRequest(apiBody, { token: 'expired-test-session' }), 401);
      assert.equal(await readFile(envPatch.SOURCE_STORE_PATH, 'utf8'), before);
    });

    await check('valid session API creates 201 then returns unchanged duplicate 200', async () => {
      const first = await readSuccess(await apiRequest(apiBody), 201);
      assert.equal(first.source.ownerMemberId, apiScope.ownerMemberId);
      assert.equal(first.source.notebookId, apiScope.notebookId);
      assert.deepEqual(first.source.literature, paper);
      assert(first.source.chunkCount > 0);
      assert(first.source.chunks.every(chunk => chunk.sourceId === first.source.id));
      const duplicate = await readSuccess(await apiRequest({
        ...apiBody, resultToken: signedRaw({
          ...paper, doi: 'https://doi.org/10.1234/example.paper', source: 'openalex', provider: 'OpenAlex',
          abstract: 'Must not overwrite the first abstract.', retrievedAt: '2026-09-19T00:00:00.000Z',
        }),
      }), 200);
      assert.deepEqual(duplicate.source, first.source);
      assert.deepEqual(await listIngestionSources(apiScope), [first.source]);
      assert.deepEqual(await getIngestionSource(first.source.id, apiScope), first.source);
    });

    await check('authenticated API rejects malformed, tampered and oversized result tokens with 400', async () => {
      const payload = apiBody.resultToken.split('.')[0];
      const tokens = ['', 'x', '.', 'x.y', `${payload}.a`, `${payload}.${'0'.repeat(64)}`,
        `${payload}.${'0'.repeat(66)}`, `!.${'0'.repeat(64)}`,
        'x'.repeat(MAX_LITERATURE_RESULT_TOKEN_LENGTH + 1)];
      await rejectBadBodies(tokens.map(resultToken => ({ ...apiBody, resultToken })));
    });

    await check('authenticated API rejects malformed JSON and request schemas with 400', async () => {
      const before = await readFile(envPatch.SOURCE_STORE_PATH, 'utf8');
      for (const raw of ['{', '']) await readError(await apiRequest(raw, { raw: true }), 400);
      assert.equal(await readFile(envPatch.SOURCE_STORE_PATH, 'utf8'), before);
      await rejectBadBodies([null, [], {}, { notebookId: apiScope.notebookId },
        { resultToken: apiBody.resultToken }, { ...apiBody, resultToken: 123 },
        { ...apiBody, resultToken: null }, { ...apiBody, extra: true }]);
    });

    await check('authenticated API rejects correctly signed invalid metadata schemas with 400', async () => {
      const invalidMetadata: unknown[] = [null, [], {},
        { ...paper, title: '  ' }, { ...paper, authors: 'Ada' }, { ...paper, year: {} },
        { ...paper, url: 'javascript:alert(1)' }, { ...paper, abstract: null },
        { ...paper, evidenceScope: 'fabricated' }, { ...paper, retrievedAt: 'yesterday' },
      ];
      await rejectBadBodies(invalidMetadata.map(value => ({ ...apiBody, resultToken: signedRaw(value) })));
    });

    await check('authenticated API rejects invalid notebook IDs with 400', async () => {
      const notebookIds: unknown[] = ['', '   ', '../invalid', 'a/b', 'a\\b', 'has space',
        '-leading', 'x'.repeat(97), 'x'.repeat(129), null, 123];
      await rejectBadBodies(notebookIds.map(notebookId => ({ ...apiBody, notebookId })));
    });

    await check('authenticated API rejects client-supplied ownership fields with 400', async () => {
      const spoofedOwners = [
        { ownerMemberId: 'api-member-b' }, { ownerMemberId: apiScope.ownerMemberId },
        { memberId: 'api-member-b' }, { owner_member_id: 'api-member-b' },
        { tenantId: 'other-tenant' }, { owner: { memberId: 'api-member-b' } },
      ];
      await rejectBadBodies(spoofedOwners.map(fields => ({ ...apiBody, ...fields })));
      assert.equal((await listIngestionSources({ ...apiScope, ownerMemberId: 'api-member-b' })).length, 0);
    });

    await check('API derives owner from session and isolates another member and notebook', async () => {
      const original = (await listIngestionSources(apiScope))[0];
      const memberScope = { ...apiScope, ownerMemberId: 'api-member-b' };
      const notebookScope = { ...apiScope, notebookId: 'api-notebook-b' };
      const otherMember = await readSuccess(await apiRequest(apiBody, { token: sessionB }), 201);
      const otherNotebook = await readSuccess(await apiRequest({ ...apiBody, notebookId: notebookScope.notebookId }), 201);
      assert.equal(otherMember.source.ownerMemberId, memberScope.ownerMemberId);
      assert.equal(otherMember.source.notebookId, memberScope.notebookId);
      assert.equal(otherNotebook.source.ownerMemberId, notebookScope.ownerMemberId);
      assert.equal(otherNotebook.source.notebookId, notebookScope.notebookId);
      assert.equal(new Set([original.id, otherMember.source.id, otherNotebook.source.id]).size, 3);
      const records = [original, otherMember.source, otherNotebook.source];
      const scopes = [apiScope, memberScope, notebookScope];
      for (const [index, currentScope] of scopes.entries()) {
        assert.deepEqual(await listIngestionSources(currentScope), [records[index]]);
        for (const [recordIndex, record] of records.entries()) {
          assert.deepEqual(await getIngestionSource(record.id, currentScope), recordIndex === index ? record : undefined);
          if (recordIndex !== index) {
            assert.equal((await listReadySourceChunks({ ...currentScope, identities: [record.id] })).chunks.length, 0);
          }
        }
      }
      const duplicateMember = await readSuccess(await apiRequest(apiBody, { token: sessionB }), 200);
      const duplicateNotebook = await readSuccess(await apiRequest({ ...apiBody, notebookId: notebookScope.notebookId }), 200);
      assert.deepEqual(duplicateMember.source, otherMember.source);
      assert.deepEqual(duplicateNotebook.source, otherNotebook.source);
    });

    const sparseApiScope = { ...apiScope, notebookId: 'api-sparse' };
    const sparseApiBody = { resultToken: signedRaw(sparsePaper), notebookId: sparseApiScope.notebookId };
    await check('sparse API import is 201 then cross-time cross-provider duplicate 200', async () => {
      const first = await readSuccess(await apiRequest(sparseApiBody), 201);
      const duplicate = await readSuccess(await apiRequest({
        ...sparseApiBody, resultToken: signedRaw(sparseRediscovered),
      }), 200);
      assert.deepEqual(duplicate.source, first.source);
      assert.deepEqual(first.source.literature, JSON.parse(JSON.stringify(sparsePaper)));
      assert.deepEqual(await listIngestionSources(sparseApiScope), [first.source]);
    });

    await check('16 concurrent authenticated sparse imports return one 201 and fifteen 200s', async () => {
      const concurrentScope = { ...apiScope, notebookId: 'api-sparse-concurrent' };
      const responses = await Promise.all(Array.from({ length: 16 }, (_, index) => apiRequest({
        notebookId: concurrentScope.notebookId,
        resultToken: signedRaw({
          ...(index % 2 ? sparseRediscovered : sparsePaper),
          retrievedAt: new Date(Date.UTC(2026, 8, 1, 0, 0, index)).toISOString(),
        }),
      })));
      assert.equal(responses.filter(response => response.status === 201).length, 1);
      assert.equal(responses.filter(response => response.status === 200).length, 15);
      const results = await Promise.all(responses.map(response => readSuccess(response, response.status === 201 ? 201 : 200)));
      assert.equal(new Set(results.map(result => result.source.id)).size, 1);
      assert.deepEqual(await listIngestionSources(concurrentScope), [results[0].source]);
      const fresh = (await new LocalJsonSourceStoreAdapter().read()).sources.filter(source => (
        source.ownerMemberId === concurrentScope.ownerMemberId && source.notebookId === concurrentScope.notebookId
      ));
      assert.deepEqual(fresh, [results[0].source]);
    });

    await check('sparse API keeps same title with different URLs or abstracts as new entries', async () => {
      for (const variant of [
        { ...sparsePaper, url: `${sparsePaper.url}/different` },
        { ...sparsePaper, abstract: 'A genuinely different abstract.' },
      ]) {
        const result = await readSuccess(await apiRequest({ ...sparseApiBody, resultToken: signedRaw(variant) }), 201);
        assert.deepEqual(result.source.literature, JSON.parse(JSON.stringify(variant)));
      }
      const sources = await listIngestionSources(sparseApiScope);
      assert.equal(sources.length, 3);
      assert.equal(new Set(sources.map(source => source.id)).size, 3);
    });

    await check('API write failure returns 500 with no saved success and retries after recovery', async () => {
      const originalDisk = await readFile(envPatch.SOURCE_STORE_PATH, 'utf8');
      const blockedParent = path.join(tmpDir, 'blocked-store-parent');
      const failedPath = path.join(blockedParent, 'sources.json');
      const retryScope = { ...apiScope, notebookId: 'api-retry' };
      const retryBody = { ...sparseApiBody, notebookId: retryScope.notebookId };
      // A file where the parent directory must be makes mkdir/write fail on Windows and POSIX.
      await writeFile(blockedParent, 'intentional write blocker', 'utf8');
      process.env.SOURCE_STORE_PATH = failedPath;
      try {
        assert.equal(sourceStoreStatus().path, failedPath);
        await readError(await apiRequest(retryBody), 500);
        assert.deepEqual(await listIngestionSources(retryScope), []);
        assert.deepEqual((await new LocalJsonSourceStoreAdapter().read()).sources, []);
        await assert.rejects(readFile(failedPath, 'utf8'));
        assert.equal(await readFile(blockedParent, 'utf8'), 'intentional write blocker');
        assert.equal(await readFile(envPatch.SOURCE_STORE_PATH, 'utf8'), originalDisk);
        await rm(blockedParent);
        const retried = await readSuccess(await apiRequest(retryBody), 201);
        assert.deepEqual(await listIngestionSources(retryScope), [retried.source]);
        assert.deepEqual((await new LocalJsonSourceStoreAdapter().read()).sources, [retried.source]);
        const duplicate = await readSuccess(await apiRequest(retryBody), 200);
        assert.deepEqual(duplicate.source, retried.source);
        assert.equal((await listIngestionSources(retryScope)).length, 1);
      } finally {
        process.env.SOURCE_STORE_PATH = envPatch.SOURCE_STORE_PATH;
      }
      assert.equal(await readFile(envPatch.SOURCE_STORE_PATH, 'utf8'), originalDisk);
      assert.deepEqual(await listIngestionSources(retryScope), []);
    });

    const fullScope = { ownerMemberId: 'fulltext-member', notebookId: 'fulltext-notebook' };
    const fullText = 'Methods: We examined the complete original study. Results: The full-text evidence is persisted, not merely an abstract. '.repeat(30);
    const fullFixture = async () => ({ fullText, pdfUrl: 'https://example.org/paper.pdf', source: 'direct' as const, charCount: fullText.length });

    await check('first import persists full text and survives fresh store reads', async () => {
      const result = await importLiteratureSource(paper, fullScope, { fetchFullText: fullFixture });
      assert.equal(result.alreadyExists, false);
      assert.equal(result.fullText.status, 'downloaded');
      assert.equal(result.source.literature?.evidenceScope, 'fulltext');
      assert(result.source.chunks.some(chunk => chunk.text.includes('complete original study')));
      const restored = await getIngestionSource(result.source.id, fullScope);
      assert.deepEqual(restored, JSON.parse(JSON.stringify(result.source)));
      const evidence = await listReadySourceChunks({ ...fullScope, identities: [result.source.id] });
      assert(evidence.chunks.some(chunk => chunk.text.includes('complete original study')));
    });

    await check('existing full text is reused without a new download or downgrade', async () => {
      let downloads = 0;
      const result = await importLiteratureSource(paper, fullScope, { fetchFullText: async () => {
        downloads++;
        throw new Error('Should never download');
      } });
      assert.equal(result.alreadyExists, true);
      assert.equal(result.fullText.status, 'existing');
      assert.equal(result.source.literature?.evidenceScope, 'fulltext');
      assert.equal(downloads, 0);
    });

    await check('previous metadata-only entry can be upgraded without duplicate or lost identity', async () => {
      const retryScope = { ...fullScope, notebookId: 'fulltext-retry' };
      const metadata = { ...paper, abstract: '', arxivId: undefined };
      const first = await importLiteratureSource(metadata, retryScope);
      assert.equal(first.source.literature?.evidenceScope, 'metadata');
      assert.equal(first.fullText.status, 'partial');
      const result = await importLiteratureSource(metadata, retryScope, { fetchFullText: fullFixture });
      assert.equal(result.alreadyExists, true);
      assert.equal(result.source.id, first.source.id);
      assert.equal(result.source.createdAt, first.source.createdAt);
      assert.equal(result.source.literature?.evidenceScope, 'fulltext');
      assert.equal((await listIngestionSources(retryScope)).length, 1);
    });

    await check('repeated retrieval replaces original evidence without duplicate entries or appended chunks', async () => {
      const retryScope = { ...fullScope, notebookId: 'replace-existing-evidence' };
      const first = await importLiteratureSource(paper, retryScope);
      const failedRetry = await importLiteratureSource(paper, retryScope);
      assert.deepEqual(failedRetry.source, first.source);
      let downloads = 0;
      const fetchFullText = async () => { downloads++; return fullFixture(); };
      const replacement = await importLiteratureSource(paper, retryScope, { fetchFullText });
      const expectedChunks = buildSourceChunks([{
        id: first.source.id, title: first.source.title, abstract: paper.abstract,
        rawContent: fullText, shortName: first.source.shortName, literature: { evidenceScope: 'fulltext' },
      }]);
      assert.equal(replacement.source.id, first.source.id);
      assert.equal(replacement.source.createdAt, first.source.createdAt);
      assert.deepEqual(replacement.source.chunks, expectedChunks);
      const repeated = await importLiteratureSource({ ...paper, retrievedAt: '2026-09-24T00:00:00.000Z' }, retryScope, { fetchFullText });
      assert.equal(repeated.alreadyExists, true);
      assert.equal(repeated.fullText.status, 'existing');
      assert.equal(downloads, 1);
      const persisted = JSON.parse(JSON.stringify(replacement.source));
      assert.deepEqual(repeated.source, persisted);
      assert.deepEqual(await listIngestionSources(retryScope), [persisted]);
    });

    await check('arXiv-only metadata reaches the full-text resolver without requiring a DOI', async () => {
      const metadata = { ...paper, doi: undefined, url: 'https://arxiv.org/abs/2501.01234v2' };
      const result = await importLiteratureSource(metadata, { ...fullScope, notebookId: 'arxiv-fulltext' }, {
        fetchFullText: async input => {
          assert.equal(input.doi, undefined);
          assert.equal(input.arxivId, metadata.arxivId);
          return fullFixture();
        },
      });
      assert.equal(result.source.literature?.evidenceScope, 'fulltext');
    });

    await check('all acquisition failures return reasons and preserve partial evidence', async () => {
      const codes: FullTextFailureCode[] = ['no_oa', 'network_error', 'extraction_failed', 'no_identifier', 'unsafe_url', 'too_large'];
      for (const code of codes) {
        const failureScope = { ...fullScope, notebookId: `failure-${code}` };
        const metadata = { ...paper, abstract: code === 'no_oa' ? '' : paper.abstract };
        const result = await importLiteratureSource(metadata, failureScope, { fetchFullText: async () => {
          throw new FullTextError(code, `失败原因：${code}`);
        } });
        assert.deepEqual(result.fullText, { status: 'partial', code, message: `失败原因：${code}` });
        assert.equal(result.source.literature?.evidenceScope, metadata.abstract ? 'abstract' : 'metadata');
        assert.equal(result.source.chunkCount > 0, Boolean(metadata.abstract));
        assert(!result.source.chunks.some(chunk => chunk.text.includes('complete original study')));
      }
      const result = await importLiteratureSource(paper, { ...fullScope, notebookId: 'empty-fulltext' }, {
        fetchFullText: async () => ({ ...await fullFixture(), fullText: ' \n ' }),
      });
      assert.equal(result.fullText.status, 'partial');
      assert.equal(result.source.literature?.evidenceScope, 'abstract');
    });

    await check('concurrent imports share one full-text acquisition and persist one source', async () => {
      const concurrentScope = { ...fullScope, notebookId: 'concurrent-fulltext' };
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      let writes = 0;
      let downloads = 0;
      const originalMutate = LocalJsonSourceStoreAdapter.prototype.mutate;
      const mutationMock = mock.method(LocalJsonSourceStoreAdapter.prototype, 'mutate', async function (
        this: LocalJsonSourceStoreAdapter, ...args: Parameters<typeof originalMutate>
      ) {
        const result = await originalMutate.apply(this, args);
        if (++writes === 16) release();
        return result;
      });
      try {
        const results = await Promise.all(Array.from({ length: 16 }, () => importLiteratureSource(paper, concurrentScope, {
          fetchFullText: async () => { downloads++; await gate; return fullFixture(); },
        })));
        assert.equal(downloads, 1);
        assert.equal(results.filter(result => !result.alreadyExists).length, 1);
        assert(results.every(result => result.source.literature?.evidenceScope === 'fulltext'));
        assert.equal((await listIngestionSources(concurrentScope)).length, 1);
      } finally {
        release();
        mutationMock.mock.restore();
      }
    });

    await check('late acquisition success or failure never overwrites another committed full text', async () => {
      for (const fails of [true, false]) {
        const raceScope = { ...fullScope, notebookId: `competing-fulltext-${fails}` };
        const first = await importLiteratureSource(paper, raceScope);
        const result = await importLiteratureSource(paper, raceScope, { fetchFullText: async () => {
          await new LocalJsonSourceStoreAdapter().mutate(store => {
            const source = store.sources.find(item => item.id === first.source.id)!;
            source.literature = { ...source.literature!, evidenceScope: 'fulltext' };
            source.chunks = buildSourceChunks([{
              id: source.id, title: source.title, rawContent: 'Other committed full-text evidence.',
              literature: { evidenceScope: 'fulltext' },
            }]);
            source.chunkCount = source.chunks.length;
            source.tokenEstimate = source.chunks.reduce((total, chunk) => total + chunk.tokenEstimate, 0);
            return store;
          });
          if (fails) throw new FullTextError('network_error', 'Late failed request');
          return fullFixture();
        } });
        assert.equal(result.fullText.status, 'existing');
        assert.equal(result.source.literature?.evidenceScope, 'fulltext');
        assert(result.source.chunks.some(chunk => chunk.text.includes('Other committed full-text evidence.')));
        assert(!result.source.chunks.some(chunk => chunk.text.includes('complete original study')));
        assert.deepEqual(await getIngestionSource(first.source.id, raceScope), result.source);
      }
    });

    await check('upgrade persistence errors reject instead of reporting a partial download success', async () => {
      const storageScope = { ...fullScope, notebookId: 'fulltext-store-failure' };
      const first = await importLiteratureSource(paper, storageScope);
      const originalMutate = LocalJsonSourceStoreAdapter.prototype.mutate;
      let writes = 0;
      const mutationMock = mock.method(LocalJsonSourceStoreAdapter.prototype, 'mutate', async function (
        this: LocalJsonSourceStoreAdapter, ...args: Parameters<typeof originalMutate>
      ) {
        if (++writes === 2) throw new Error('Full-text storage unavailable');
        return originalMutate.apply(this, args);
      });
      try {
        await assert.rejects(importLiteratureSource(paper, storageScope, { fetchFullText: fullFixture }), /storage unavailable/);
        assert.deepEqual(await getIngestionSource(first.source.id, storageScope), first.source);
      } finally {
        mutationMock.mock.restore();
      }
      const retried = await importLiteratureSource(paper, storageScope, { fetchFullText: fullFixture });
      assert.equal(retried.fullText.status, 'downloaded');
    });

    await check('API rejects supplied full text instead of treating client data as evidence', async () => {
      await rejectBadBodies([{ ...apiBody, fullText: 'forged original evidence' }, { ...apiBody, evidenceScope: 'fulltext' }]);
      const result = await readSuccess(await apiRequest(apiBody), 200);
      assert.equal(result.fullText.status, 'partial');
      assert.equal(result.source.literature?.evidenceScope, 'abstract');
    });

    assertFetchBoundary();
    const statusSummary = [...apiStatuses.entries()].sort(([a], [b]) => a - b)
      .map(([status, count]) => `${status}=${count}`).join(', ');
    console.log(`Literature import: ${passed} test groups passed; API ${statusSummary}; ${authCalls.length} stubbed auth/me calls; real temporary JSON store; no real network/downloads/embeddings; no live Postgres.`);
  } finally {
    globalThis.fetch = previousFetch;
    dnsMock.mock.restore();
    httpsMock.mock.restore();
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
