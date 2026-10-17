import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const app = createRequire(`${process.cwd()}/package.json`);
async function main() {
  const reopening = process.argv.includes('--reopen');
  const fixture = reopening ? process.argv[process.argv.indexOf('--reopen') + 1] : await mkdtemp(path.join(tmpdir(), 'knowtrail-data-'));
  Object.assign(process.env, { STUDIO_DOCUMENT_STORE_DIR: path.join(fixture, 'documents'), SOURCE_STORE_PATH: path.join(fixture, 'sources.json'), SOURCE_STORE_ADAPTER: 'local-json', ZVEC_STORE_PATH: path.join(fixture, 'zvec'), PAPER_HOST_SESSION_VERIFY_URL: 'https://sms-fixture.invalid/session?provider=knowtrail' });
  for (const key of ['OPENAI_COMPAT_API_KEY', 'ARK_API_KEY', 'OPENAI_API_KEY']) process.env[key] = '';
  const { NextRequest } = app('next/server');
  const artifacts = app('./src/app/api/studio/artifacts/route.ts');
  const generation = app('./src/app/api/data-processing/plan/route.ts');
  const { ingestExtractedSource } = app('./src/lib/ingestion-store.ts');
  const { emptyDataProcessing } = app('./src/lib/data-processing-document.ts');
  const notebookId = 'data-processing-fixture';
  globalThis.fetch = async (input, init) => {
    assert.ok(String(input).includes('sms-fixture.invalid'), 'No model or external calls');
    const cookie = new Headers(init?.headers).get('cookie') || '';
    const who = cookie.includes('fixture-valid-a') ? 'a' : cookie.includes('fixture-valid-b') ? 'b' : null;
    return who ? Response.json({ data: { authenticated: true, provider: 'knowtrail', workspaceKey: `paper-user-${who.repeat(32)}`, capabilities: ['verified-sms-session'] } }) : Response.json({}, { status: 401 });
  };
  const request = (route: string, method = 'GET', body?: unknown, who = 'a') => new NextRequest(`https://fixture.invalid/knowtrail/api/${route}`, { method, headers: { ...(who ? { cookie: `userId=fixture; token=fixture-valid-${who}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const get = (who = 'a', download = false, revision = '') => artifacts.GET(request(`studio/artifacts?kind=data-processing&notebookId=${notebookId}${download ? `&download=1&revision=${revision}` : ''}`, 'GET', undefined, who));
  if (reopening) {
    const saved = (await (await get()).json()).document;
    assert.equal(saved.data.plan.dataset.rowCount, 3);
    assert.equal(saved.data.plan.dataset.columns[1].missingCount, 1);
    console.log(JSON.stringify({ ok: true, freshProcessRestore: true }));
    return;
  }
  assert.equal((await get()).status, 404);
  const rawContent = 'record_id,timestamp,value\n1,2022-01-01,5\n2,,6\n3,2022-01-03,7';
  const paper = { id: 'data-source', title: '软件验收模拟表格', fileName: 'simulated.csv', fileType: 'csv', content: rawContent, rawContent };
  await ingestExtractedSource({ ...paper, ownerMemberId: `paper-host:paper-user-${'a'.repeat(32)}`, notebookId });
  const input = { notebookId, paper: { ...paper, content: 'forged', rawContent: 'forged' }, question: '核对缺失情况，不训练模型', sampleUnit: '一条模拟记录', taskFamily: 'description', persistArtifact: true, expectedRevision: null };
  const post = (body = input, who = 'a') => generation.POST(request('data-processing/plan', 'POST', body, who));
  const response = await post();
  assert.equal(response.status, 200);
  const generated = await response.json();
  assert.equal(generated.data.dataset.rowCount, 3, 'Uses verified stored source, not forged client content');
  assert.equal(generated.data.dataset.columns[1].missingCount, 1);
  const saved = generated.document;
  assert.deepEqual((await (await get()).json()).document, saved);
  const download = await get('a', true, saved.revision);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('Cache-Control'), 'private, no-store');
  assert.match(download.headers.get('Content-Disposition') || '', /attachment/);
  assert.equal(await download.text(), saved.data.plan.artifactMarkdown);
  assert.equal((await post(input, 'b')).status, 404);
  assert.equal((await get('b')).status, 404);
  assert.equal((await get('', true, saved.revision)).status, 401);
  assert.equal((await post()).status, 409);
  const stale = await artifacts.PUT(request('studio/artifacts?kind=data-processing', 'PUT', { notebookId, data: emptyDataProcessing(), expectedRevision: null }));
  assert.equal(stale.status, 409);
  assert.equal((await artifacts.PUT(request('studio/artifacts?kind=data-processing', 'PUT', { notebookId, data: saved.data, expectedRevision: null }))).status, 200);
  const newer = await post({ ...input, question: '新版本问题，仅用于软件验收', expectedRevision: saved.revision });
  assert.equal(newer.status, 200);
  assert.equal(await (await get('a', true, saved.revision)).text(), saved.data.plan.artifactMarkdown, 'An older visible plan exports its exact saved version');
  assert.equal((await get('a', true, '../current')).status, 400);
  const reopened = spawnSync(process.execPath, ['--import', 'tsx', process.argv[1], '--reopen', fixture], { cwd: process.cwd(), env: process.env, encoding: 'utf8' });
  assert.equal(reopened.status, 0, reopened.stdout + reopened.stderr);
  console.log(JSON.stringify({ ok: true, actualPostSourceOwnershipAndSave: true, privateDownload: true, conflicts: true, freshProcess: true, paidCalls: 0 }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
