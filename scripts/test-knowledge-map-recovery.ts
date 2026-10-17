import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const app = createRequire(`${process.cwd()}/package.json`);
async function main() {
  const reopening = process.argv.includes('--reopen');
  const fixture = reopening ? process.argv[process.argv.indexOf('--reopen') + 1] : await mkdtemp(path.join(tmpdir(), 'knowtrail-map-'));
  Object.assign(process.env, { STUDIO_DOCUMENT_STORE_DIR: path.join(fixture, 'documents'), SOURCE_STORE_PATH: path.join(fixture, 'sources.json'), SOURCE_STORE_ADAPTER: 'local-json', ZVEC_STORE_PATH: path.join(fixture, 'zvec'), PAPER_HOST_SESSION_VERIFY_URL: 'https://sms-fixture.invalid/session?provider=knowtrail' });
  for (const key of ['OPENAI_COMPAT_API_KEY', 'ARK_API_KEY', 'OPENAI_API_KEY']) process.env[key] = '';
  const { NextRequest } = app('next/server');
  const artifacts = app('./src/app/api/studio/artifacts/route.ts');
  const generation = app('./src/app/api/ai/knowledge-map/route.ts');
  const { ingestExtractedSource } = app('./src/lib/ingestion-store.ts');
  const notebookId = 'knowledge-map-fixture';
  globalThis.fetch = async (input, init) => {
    assert.ok(String(input).includes('sms-fixture.invalid'), 'No external or paid provider calls');
    const cookie = new Headers(init?.headers).get('cookie') || '';
    const who = cookie.includes('fixture-valid-a') ? 'a' : cookie.includes('fixture-valid-b') ? 'b' : null;
    return who ? Response.json({ data: { authenticated: true, provider: 'knowtrail', workspaceKey: `paper-user-${who.repeat(32)}`, capabilities: ['verified-sms-session'] } }) : Response.json({}, { status: 401 });
  };
  const request = (route: string, method = 'GET', body?: unknown, who = 'a') => new NextRequest(`https://fixture.invalid/knowtrail/api/${route}`, { method, headers: { ...(who ? { cookie: `userId=fixture; token=fixture-valid-${who}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const get = (who = 'a') => artifacts.GET(request(`studio/artifacts?kind=knowledge-map&notebookId=${notebookId}`, 'GET', undefined, who));
  if (reopening) {
    const saved = (await (await get()).json()).document;
    assert.ok(saved.data.session.map.nodes.length > 0);
    assert.ok(saved.data.session.citations.length > 0);
    console.log(JSON.stringify({ ok: true, freshProcessRestore: true }));
    return;
  }
  assert.equal((await get()).status, 404);
  assert.equal((await get('')).status, 401);
  const rawContent = '软件验收模拟记录，12条记录中2条缺少时间戳，剔除后保留10条。流程：导入记录、检查时间戳、剔除缺失记录、人工核对。数据仅用于软件验收，不是真实科研结果。';
  const paper = { id: 'map-source', title: '模拟记录核验', fileName: '记录.txt', fileType: 'txt', content: rawContent, rawContent };
  await ingestExtractedSource({ ...paper, ownerMemberId: `paper-host:paper-user-${'a'.repeat(32)}`, notebookId });
  const input = { notebookId, papers: [paper], persistArtifact: true, expectedRevision: null };
  const response = await generation.POST(request('ai/knowledge-map', 'POST', input));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  const generated = await response.json();
  assert.ok(generated.document.data.session.map.nodes.length > 0);
  assert.equal(generated.document.data.session.citations[0].paperId, paper.id);
  assert.deepEqual((await (await get()).json()).document, generated.document);
  assert.equal((await get('b')).status, 404);
  assert.equal((await generation.POST(request('ai/knowledge-map', 'POST', input))).status, 409);
  const again = await generation.POST(request('ai/knowledge-map', 'POST', { ...input, expectedRevision: generated.document.revision }));
  const cached = await again.json();
  assert.equal(again.status, 200);
  assert.equal(cached.cache.hit, true);
  const cache = await readFile(path.join(fixture, 'documents', '_cache', 'knowledge-map', `${cached.cache.key}.json`), 'utf8');
  assert.ok(cache.includes('map-source'));
  const stale = await artifacts.PUT(request('studio/artifacts?kind=knowledge-map', 'PUT', { notebookId, data: { session: null }, expectedRevision: generated.document.revision }));
  assert.equal(stale.status, 409);
  const unauthorized = await artifacts.PUT(request('studio/artifacts?kind=knowledge-map', 'PUT', { notebookId, data: cached.document.data, expectedRevision: null }, ''));
  assert.equal(unauthorized.status, 401);
  const reopened = spawnSync(process.execPath, ['--import', 'tsx', process.argv[1], '--reopen', fixture], { cwd: process.cwd(), env: process.env, encoding: 'utf8' });
  assert.equal(reopened.status, 0, reopened.stdout + reopened.stderr);
  console.log(JSON.stringify({ ok: true, actualPostAndPrivateRestore: true, sharedCache: true, conflicts: true, freshProcess: true, paidCalls: 0 }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
