import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rename, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function main() {
  const fixture = await mkdtemp(path.join(tmpdir(), 'agent-learning-'));
  Object.assign(process.env, { STUDIO_DOCUMENT_STORE_DIR: path.join(fixture, 'documents'), SOURCE_STORE_PATH: path.join(fixture, 'sources.json'), SOURCE_STORE_ADAPTER: 'local-json', ZVEC_STORE_PATH: path.join(fixture, 'zvec'), PAPER_HOST_SESSION_VERIFY_URL: 'https://sms-fixture.invalid/session?provider=knowtrail', OPENAI_COMPAT_API_KEY: 'fixture-key', OPENAI_COMPAT_API_BASE: 'https://gateway-fixture.invalid/v1', OPENAI_COMPAT_MODEL: 'qwen3.8-max-0902', REAL_SERVICE_LLM_RETRIES: '1', REAL_SERVICE_FETCH_RETRIES: '1' });
  const app = createRequire(`${process.cwd()}/package.json`);
  const { NextRequest } = app('next/server');
  const route = app('./src/app/api/ai/knowledge-cards/route.ts');
  const store = app('./src/lib/private-notebook-document.ts');
  const { ingestExtractedSource } = app('./src/lib/ingestion-store.ts');
  const { readGeneratedLearning, LearningSaveError, isLearningInput } = app('./src/lib/research-agent-learning.ts');
  const { isResearchToolCall } = app('./src/lib/research-agent-contract.ts');
  const { buildQuiz } = app('./src/lib/learning-quiz.ts');
  const notebookId = 'learning-skill-fixture';
  const scope = { ownerMemberId: `paper-host:paper-user-${'a'.repeat(32)}`, notebookId };
  const directory = store.notebookDocumentDirectory(scope, 'learning-materials');
  const currentFile = path.join(directory, 'current.json');
  let calls = 0; let failSave = false; let abort: AbortController | null = null;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('sms-fixture.invalid')) {
      const who = new Headers(init?.headers).get('cookie')?.includes('fixture-valid-a') ? 'a' : new Headers(init?.headers).get('cookie')?.includes('fixture-valid-b') ? 'b' : null;
      return who ? Response.json({ data: { authenticated: true, provider: 'knowtrail', workspaceKey: `paper-user-${who.repeat(32)}`, capabilities: ['verified-sms-session'] } }) : Response.json({}, { status: 401 });
    }
    assert(url.includes('gateway-fixture.invalid'), 'No real model calls');
    if (url.includes('/embeddings')) return Response.json({ data: [{ embedding: Array(1024).fill(0.01) }] });
    const body = JSON.parse(String(init?.body)); calls++;
    assert.equal(body.model, 'qwen3.8-max-0902');
    const prompt = JSON.stringify(body.messages);
    assert(!prompt.includes('FORGED-CLIENT-CONTENT'));
    assert(prompt.includes('复习范围') && prompt.includes('12条模拟记录'));
    if (failSave) {
      // A directory at the document path fails reads on both Windows and Linux.
      await rename(currentFile, currentFile + '-backup'); await mkdir(currentFile);
      await assert.rejects(readFile(currentFile, 'utf8'), { code: 'EISDIR' });
    }
    abort?.abort();
    return Response.json({ choices: [{ message: { content: JSON.stringify({ cards: [{ category: '关键要点', title: '模拟筛选数量', content: '12条模拟记录剔除2条，保留10条。[1]', extra: '仅用于软件验收。[1]' }, { category: '方法线索', title: '模拟核验步骤', content: '导入、检查时间戳、剔除缺失、人工核对。[1]', extra: '' }] }) } }] });
  };
  await ingestExtractedSource({ id: 'learning-source', ...scope, title: '软件验收模拟记录', fileName: 'fixture.txt', fileType: 'txt', content: '12条模拟记录剔除2条保留10条。导入、检查时间戳、剔除缺失、人工核对。仅用于软件验收，未提供单位或性能结论。' });
  const input = { kind: 'quiz', question: '复习模拟数量及步骤，非科研结果。' };
  const runId = '11111111-1111-4111-8111-111111111111';
  const request = (method: string, body?: unknown, who = 'a', revision = '', signal?: AbortSignal) => new NextRequest(`https://fixture.invalid/knowtrail/api/ai/knowledge-cards?notebookId=${notebookId}${revision ? '&revision=' + revision : ''}`, { method, headers: { ...(who ? { cookie: `userId=fixture; token=fixture-valid-${who}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal });
  const postBody = { ...input, runId, notebookId, papers: [{ id: 'learning-source', content: 'FORGED-CLIENT-CONTENT' }], expectedRevision: null as string | null };
  const payload = await (await route.POST(request('POST', postBody))).json();
  const signal = new AbortController().signal;
  const saved = await readGeneratedLearning(Response.json(payload), runId, input, null, signal);
  assert.equal(saved.data.cards.length, 2); assert.equal(calls, 1);
  const reference = { ...input, sourceIds: ['learning-source'], runId, revision: saved.revision, status: 'complete' };
  const call = { id: 'learning-1', plugin: 'quiz', query: input.question, status: 'ready', learning: reference, learningProgress: { cardIndex: 1, quizIndex: 1, answers: { '0-模拟筛选数量': 0 } } };
  assert(isResearchToolCall(call));
  assert(!isResearchToolCall({ ...call, plugin: 'report' }));
  assert(!isResearchToolCall({ ...call, learningProgress: { ...call.learningProgress, quizIndex: 9 } }));
  assert(!isLearningInput({ ...input, ownerMemberId: 'forged' }));
  await assert.rejects(readGeneratedLearning(Response.json(payload), runId, { ...input, kind: 'knowledge-cards' }, null, signal));
  assert.equal((await route.GET(request('GET', undefined, '', saved.revision))).status, 401);
  assert.equal((await route.GET(request('GET', undefined, 'b', saved.revision))).status, 404);
  assert.equal((await route.GET(request('GET', undefined, 'a', '../current'))).status, 400);
  assert.equal((await route.POST(request('POST', { ...postBody, papers: [{ id: 'unknown' }] }))).status, 404);
  assert.equal((await route.POST(request('POST', postBody))).status, 409);
  assert.equal(calls, 1, 'Stale generation rejected before model call');
  const newer = await (await route.POST(request('POST', { ...postBody, question: '复习范围二', runId: runId.replace(/1$/, '2'), expectedRevision: saved.revision }))).json();
  assert(newer.document && newer.document.revision !== saved.revision);
  assert.deepEqual((await (await route.GET(request('GET', undefined, 'a', saved.revision))).json()).document, saved);
  failSave = true;
  const failed = await route.POST(request('POST', { ...postBody, runId: runId.replace(/1$/, '3'), expectedRevision: newer.document.revision }));
  assert.equal(failed.status, 503);
  const unsaved = await failed.json();
  await readGeneratedLearning(Response.json(unsaved, { status: 503 }), runId.replace(/1$/, '3'), input, newer.document.revision, signal).then(() => assert.fail('Unsaved is not durable'), (error: unknown) => assert(error instanceof LearningSaveError));
  await rmdir(currentFile); await rename(currentFile + '-backup', currentFile); failSave = false;
  assert.deepEqual((await (await route.GET(request('GET'))).json()).document, newer.document, 'Failed save must preserve the previous document');
  const beforeRetry = calls;
  const retried = await route.PUT(request('PUT', { notebookId, data: unsaved.unsavedDocument, expectedRevision: newer.document.revision }));
  assert.equal(retried.status, 200); assert.equal(calls, beforeRetry);
  const current = (await retried.json()).document;
  assert.equal((await route.PUT(request('PUT', { notebookId, data: saved.data, expectedRevision: saved.revision }))).status, 409);
  assert.equal((await route.GET(request('GET'))).headers.get('Cache-Control'), 'private, no-store');
  abort = new AbortController();
  const stopped = await route.POST(request('POST', { ...postBody, runId: runId.replace(/1$/, '4'), expectedRevision: current.revision }, 'a', '', abort.signal));
  assert.equal(stopped.status, 504);
  assert.equal((await (await route.GET(request('GET'))).json()).document.revision, current.revision, 'Aborted generation cannot publish');
  const questions = buildQuiz(saved.data.cards);
  assert.equal(questions.length, 2); assert(questions.every((q: { options: string[] }) => q.options.length === 2));
  console.log(JSON.stringify({ ok: true, actualGeneratorAndStore: true, canonicalSources: true, immutableOldVersion: true, unsavedRetryModelCallsUnchanged: true, conflictPreserved: true, abortDidNotPublish: true, paidCalls: 0, fixtureModelCalls: calls }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
