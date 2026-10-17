import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const app = createRequire(`${process.cwd()}/package.json`);
const reopening = process.argv.includes('--reopen');
async function main() {
const fixture = reopening ? process.argv[process.argv.indexOf('--reopen') + 1] : await mkdtemp(path.join(tmpdir(), 'knowtrail-learning-'));
process.env.STUDIO_DOCUMENT_STORE_DIR = path.join(fixture, 'documents');
process.env.SOURCE_STORE_PATH = path.join(fixture, 'sources.json');
process.env.SOURCE_STORE_ADAPTER = 'local-json';
process.env.PAPER_HOST_SESSION_VERIFY_URL = 'https://sms-fixture.invalid/session?provider=knowtrail';
process.env.REAL_SERVICE_LLM_RETRIES = '1';
process.env.REAL_SERVICE_FETCH_RETRIES = '1';
for (const key of ['OPENAI_COMPAT_API_KEY', 'ARK_API_KEY', 'OPENAI_API_KEY']) process.env[key] = '';
const ownerMemberId = `paper-host:paper-user-${'a'.repeat(32)}`;
const notebookId = 'learning-fixture';
const { NextRequest } = app('next/server');
const route = app('./src/app/api/ai/knowledge-cards/route.ts');
const store = app('./src/lib/private-notebook-document.ts');
const { emptyLearningMaterials, learningCardExtra } = app('./src/lib/learning-materials.ts');
assert.equal(learningCardExtra('原文未提供性能。sourceId: paper-123-abc, chunkId: paper-123-abc::chunk-1'), '原文未提供性能。');
assert.equal(learningCardExtra('sourceId: paper-123-abc, chunkId: paper-123-abc::chunk-1'), '');
const { ingestExtractedSource } = app('./src/lib/ingestion-store.ts');
let modelCalls = 0;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes('sms-fixture.invalid')) {
    const cookie = new Headers(init?.headers).get('cookie') || '';
    const who = cookie.includes('fixture-valid-a') ? 'a' : cookie.includes('fixture-valid-b') ? 'b' : null;
    return who ? Response.json({ data: { authenticated: true, provider: 'knowtrail', workspaceKey: `paper-user-${who.repeat(32)}`, capabilities: ['verified-sms-session'] } }) : Response.json({}, { status: 401 });
  }
  assert.ok(url.includes('gateway-fixture.invalid'), 'No real network or model spending');
  const request = JSON.parse(String(init?.body));
  if (url.includes('/embeddings')) return Response.json({ data: [{ embedding: Array(1024).fill(0.01) }] });
  modelCalls++;
  assert.equal(request.model, 'qwen3.8-max-0902');
  assert.equal(request.enable_thinking, false);
  assert.equal(request.max_tokens, 2400);
  assert.ok(!request.messages[0].content.includes('200-400字'));
  const content = JSON.stringify({ cards: [{ category: '关键要点', title: '模拟记录筛选', content: '12条模拟记录剔除2条，保留10条，仅用于软件验收。[1]', extra: '原文未提供性能结论。' }, { category: '方法线索', title: '核验步骤', content: '导入→检查时间戳→剔除缺失→人工核对。[1]', extra: '' }] });
  return Response.json({ choices: [{ message: { content } }] });
};
const request = (method: string, body?: unknown, who = 'a') => new NextRequest(`https://fixture.invalid/knowtrail/api/ai/knowledge-cards?notebookId=${notebookId}`, {
  method, headers: { ...(who ? { cookie: `userId=fixture; token=fixture-valid-${who}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
});
const get = (who = 'a') => route.GET(request('GET', undefined, who));
const put = (data: unknown, expectedRevision: string | null, who = 'a') => route.PUT(request('PUT', { notebookId, data, expectedRevision }, who));
const scope = { ownerMemberId, notebookId };

if (reopening) {
  const saved = (await (await get()).json()).document;
  assert.equal(saved.data.quizIndex, 1);
  assert.equal(saved.data.answers['0-模拟记录筛选'], 0);
  assert.equal(saved.data.cards[0].title, '模拟记录筛选');
  console.log(JSON.stringify({ ok: true, freshProcessRestore: true, modelCalls }));
} else {
  assert.equal((await get()).status, 404);
  assert.equal((await get('')).status, 401);
  const rawContent = '标题：软件验收专用资料\n作者：样本甲\n年份：2022\n12条模拟记录剔除2条，保留10条。核验顺序：导入→检查时间戳→剔除缺失→人工核对。未提供性能结论。';
  await ingestExtractedSource({ id: 'learning-source', ownerMemberId, notebookId, fileName: 'fixture.txt', fileType: 'txt', title: '软件验收专用资料', content: rawContent, rawContent });
  Object.assign(process.env, { OPENAI_COMPAT_API_KEY: 'fixture-key', OPENAI_COMPAT_API_BASE: 'https://gateway-fixture.invalid/v1', OPENAI_COMPAT_MODEL: 'qwen3.8-max-0902' });
  const body = { notebookId, expectedRevision: null, papers: [{ id: 'learning-source', title: '软件验收专用资料', content: rawContent, rawContent, fileType: 'txt', fileName: 'fixture.txt' }] };
  const generated = await route.POST(request('POST', body));
  assert.equal(generated.status, 200);
  assert.equal(generated.headers.get('cache-control'), 'private, no-store');
  const initial = (await generated.json()).document;
  assert.equal(initial.data.cards.length, 2);
  assert.equal(modelCalls, 1);
  assert.equal((await get('b')).status, 404);
  const progress = { ...initial.data, cardIndex: 1, quizIndex: 1, answers: { '0-模拟记录筛选': 0 } };
  const saved = (await (await put(progress, initial.revision)).json()).document;
  const retried = (await (await put(progress, initial.revision)).json()).document;
  assert.equal(retried.revision, saved.revision, 'Same content retry is idempotent even after a lost response');
  assert.equal(retried.updatedAt, saved.updatedAt);
  assert.equal((await put({ ...progress, quizIndex: 0 }, initial.revision)).status, 409);
  assert.equal((await route.POST(request('POST', body))).status, 409, 'Reject stale generation before spending');
  assert.equal(modelCalls, 1);
  assert.equal((await put(progress, null, '')).status, 401);
  assert.equal((await put({ ...progress, cardIndex: 99 }, saved.revision)).status, 400);
  assert.equal((await put({ ...progress, citations: [null] }, saved.revision)).status, 400);
  assert.equal((await put({ ...progress, retrieval: 'invalid' }, saved.revision)).status, 400);
  const empty = emptyLearningMaterials();
  const outcomes = await Promise.allSettled([
    store.saveNotebookDocument(scope, 'concurrent-test', { ...empty, cards: initial.data.cards }, null),
    store.saveNotebookDocument(scope, 'concurrent-test', { ...empty, cards: initial.data.cards, cardIndex: 1 }, null),
  ]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/test-learning-materials-recovery.ts', '--reopen', fixture], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr + child.stdout);
  const directories = await readdir(path.join(fixture, 'documents'));
  const currentPath = path.join(fixture, 'documents', directories.find(item => item !== 'knowledge-card-cache')!, notebookId, 'learning-materials', 'current.json');
  const original = await readFile(currentPath, 'utf8');
  await writeFile(currentPath, '{bad json');
  assert.equal((await get()).status, 503);
  assert.equal((await put(progress, saved.revision)).status, 503, 'Corruption must not silently overwrite saved data');
  await writeFile(currentPath, original);
  await assert.rejects(store.saveNotebookDocument({ ...scope, notebookId: '../outside' }, 'learning-materials', empty, null));
  console.log(JSON.stringify({ ok: true, paidCalls: 0, fixtureModelCalls: modelCalls, actualPostPlannerSave: true, privateGetPut: true, idempotentRetry: true, concurrentConflict: true, corruptionPreserved: true, freshProcessRestore: JSON.parse(child.stdout.trim()).freshProcessRestore }));
}

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
