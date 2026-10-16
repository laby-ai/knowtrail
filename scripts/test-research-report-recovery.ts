import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const app = createRequire(`${process.cwd()}/package.json`);
async function main() {
  process.env.KNOWTRAIL_OBSERVABILITY_HASH_KEY = 'dedicated-report-fixture-hash-key-at-least-32-characters';
  const reopening = process.argv.includes('--reopen');
  const fixture = reopening ? process.argv[process.argv.indexOf('--reopen') + 1] : await mkdtemp(path.join(tmpdir(), 'knowtrail-report-'));
  Object.assign(process.env, { STUDIO_DOCUMENT_STORE_DIR: path.join(fixture, 'documents'), SOURCE_STORE_PATH: path.join(fixture, 'sources.json'), SOURCE_STORE_ADAPTER: 'local-json', ZVEC_STORE_PATH: path.join(fixture, 'zvec'), PAPER_HOST_SESSION_VERIFY_URL: 'https://sms-fixture.invalid/session?provider=knowtrail', REAL_SERVICE_LLM_RETRIES: '1', REAL_SERVICE_FETCH_RETRIES: '1' });
  for (const key of ['OPENAI_COMPAT_API_KEY', 'ARK_API_KEY', 'OPENAI_API_KEY']) process.env[key] = '';
  const ownerMemberId = `paper-host:paper-user-${'a'.repeat(32)}`;
  const notebookId = 'research-report-fixture';
  const currentPath = path.join(fixture, 'documents', createHash('sha256').update(ownerMemberId).digest('hex'), notebookId, 'research-report', 'current.json');
  assert.ok(currentPath.startsWith(path.resolve(fixture) + path.sep));
  const { NextRequest } = app('next/server');
  const artifacts = app('./src/app/api/studio/artifacts/route.ts');
  const generation = app('./src/app/api/ai/deep-research/route.ts');
  const { DEEP_RESEARCH_REQUIRED_SECTIONS } = app('./src/lib/deep-research-contract.ts');
  const { ingestExtractedSource } = app('./src/lib/ingestion-store.ts');
  let modelCalls = 0;
  let mode = 'normal';
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('sms-fixture.invalid')) {
      const cookie = new Headers(init?.headers).get('cookie') || '';
      const who = cookie.includes('fixture-valid-a') ? 'a' : cookie.includes('fixture-valid-b') ? 'b' : null;
      return who ? Response.json({ data: { authenticated: true, provider: 'knowtrail', workspaceKey: `paper-user-${who.repeat(32)}`, capabilities: ['verified-sms-session'] } }) : Response.json({}, { status: 401 });
    }
    assert.ok(url.includes('gateway-fixture.invalid'), 'No external or paid calls');
    if (url.includes('/embeddings')) return Response.json({ data: [{ embedding: Array(1024).fill(0.01) }] });
    modelCalls++;
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, 'qwen3.8-max-0902');
    if (mode === 'save-failure') {
      await rename(currentPath, currentPath + '.backup');
      await mkdir(currentPath);
    }
    const content = DEEP_RESEARCH_REQUIRED_SECTIONS.map((name: string) => `## ${name}\n- 模拟记录12条剔除2条后保留10条，仅用于软件验收[1]。`).join('\n\n');
    const encoded = (text: string) => new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
    if (request.enable_thinking !== false) {
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'fixture: reasoning-only response' }, finish_reason: 'length' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (mode === 'needs-repair') {
      mode = 'normal';
      return new Response(encoded('## 研究问题\n- 模拟记录12条，仅用于软件验收[1]。'), { headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (mode === 'interrupted') {
      const stream = new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(encoded('## 研究问题\n- 模拟记录12条剔除2条后保留10条，仅用于软件验收[1]。\n'));
        init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Interrupted', 'AbortError')), { once: true });
      } });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    return new Response(encoded(content), { headers: { 'Content-Type': 'text/event-stream' } });
  };
  const request = (route: string, method = 'GET', body?: unknown, who = 'a', signal?: AbortSignal) => new NextRequest(`https://fixture.invalid/knowtrail/api/${route}`, {
    method, headers: { ...(who ? { cookie: `userId=fixture; token=fixture-valid-${who}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal,
  });
  const get = (who = 'a') => artifacts.GET(request(`studio/artifacts?kind=research-report&notebookId=${notebookId}`, 'GET', undefined, who));
  const put = (data: unknown, expectedRevision: string | null, who = 'a') => artifacts.PUT(request('studio/artifacts?kind=research-report', 'PUT', { notebookId, data, expectedRevision }, who));
  const parse = (text: string) => text.split(/\r?\n\r?\n/).flatMap(frame => frame.startsWith('data: ') && frame.slice(6) !== '[DONE]' ? [JSON.parse(frame.slice(6))] : []);
  if (reopening) {
    const saved = (await (await get()).json()).document;
    assert.equal(saved.data.report.status, 'complete');
    assert.ok(saved.data.report.answer.includes('保留10条'));
    console.log(JSON.stringify({ ok: true, freshProcessRestore: true, modelCalls }));
    return;
  }
  assert.equal((await get()).status, 404);
  assert.equal((await get('')).status, 401);
  const rawContent = '这是一份软件验收用的模拟记录，不是真实科研成果。12条记录中2条缺时间戳，剔除后保留10条。核验顺序：导入、检查时间戳、剔除缺失、人工核对。未提供性能、单位或显著性。';
  await ingestExtractedSource({ id: 'report-source', ownerMemberId, notebookId, fileName: 'report.txt', fileType: 'txt', title: '软件验收模拟记录', content: rawContent, rawContent });
  Object.assign(process.env, { OPENAI_COMPAT_API_KEY: 'fixture-key', OPENAI_COMPAT_API_BASE: 'https://gateway-fixture.invalid/v1', OPENAI_COMPAT_MODEL: 'qwen3.8-max-0902' });
  const draft = { questionDraft: '核对模拟记录', report: null };
  const draftSaved = (await (await put(draft, null)).json()).document;
  const input = { notebookId, question: draft.questionDraft, papers: [{ id: 'report-source', title: '软件验收模拟记录', content: rawContent, rawContent, fileName: 'report.txt', fileType: 'txt' }], persistArtifact: true, runId: '00000000-0000-4000-a000-000000000001', expectedRevision: draftSaved.revision };
  const generated = await generation.POST(request('ai/deep-research', 'POST', input));
  assert.equal(generated.status, 200);
  const frames = parse(await generated.text());
  let saved = frames.find(item => item.document)?.document;
  assert.ok(saved, 'Success must include the server durable-save acknowledgement');
  assert.equal(saved.data.report.status, 'complete');
  assert.equal(saved.data.report.citations.length, 1);
  assert.equal((await (await get()).json()).document.revision, saved.revision);
  const callsBeforeConflict = modelCalls;
  assert.equal((await generation.POST(request('ai/deep-research', 'POST', input))).status, 409);
  assert.equal(modelCalls, callsBeforeConflict, 'Reject stale generation before provider spend');
  assert.equal((await get('b')).status, 404);
  assert.equal((await put(saved.data, saved.revision, '')).status, 401);
  assert.equal((await put({ ...draft, report: {} }, saved.revision)).status, 400);
  mode = 'needs-repair';
  const beforeRepair = modelCalls;
  const repaired = await generation.POST(request('ai/deep-research', 'POST', { ...input, expectedRevision: saved.revision, runId: '00000000-0000-4000-a000-000000000004' }));
  saved = parse(await repaired.text()).find(item => item.document)?.document;
  assert.equal(saved?.data.report.status, 'complete', 'The bounded repair must also return usable final text');
  assert.equal(saved.data.report.researchStatus.repairAttempted, true);
  assert.equal(modelCalls, beforeRepair + 2, 'Repair stays limited to one additional provider call');
  mode = 'interrupted';
  const abort = new AbortController();
  const interrupted = await generation.POST(request('ai/deep-research', 'POST', { ...input, expectedRevision: saved.revision, runId: '00000000-0000-4000-a000-000000000002' }, 'a', abort.signal));
  const reader = interrupted.body!.getReader();
  let text = '';
  while (!text.includes('"content"')) { const next = await reader.read(); assert.ok(!next.done); text += new TextDecoder().decode(next.value); }
  abort.abort();
  while (true) { const next = await reader.read(); if (next.done) break; text += new TextDecoder().decode(next.value); }
  const partial = parse(text).find(item => item.document)?.document;
  assert.equal(partial.data.report.status, 'incomplete');
  assert.ok(partial.data.report.answer.includes('模拟记录'));
  assert.equal((await (await get()).json()).document.revision, partial.revision);
  mode = 'save-failure';
  const failed = await generation.POST(request('ai/deep-research', 'POST', { ...input, expectedRevision: partial.revision, runId: '00000000-0000-4000-a000-000000000003' }));
  const failureFrames = parse(await failed.text());
  const recoverable = failureFrames.find(item => item.unsavedDocument);
  assert.ok(recoverable?.saveError && !failureFrames.some(item => item.document), 'Do not report success when final save failed');
  assert.equal(recoverable.unsavedDocument.report.status, 'complete', 'Keep completed content and audit for save-only retry');
  await rename(currentPath, currentPath + '.failed-directory');
  await rename(currentPath + '.backup', currentPath);
  const callsBeforeRetry = modelCalls;
  const recovered = await put(recoverable.unsavedDocument, partial.revision);
  assert.equal(recovered.status, 200);
  const recoveredDocument = (await recovered.json()).document;
  assert.equal(modelCalls, callsBeforeRetry);
  assert.equal((await (await put(recoverable.unsavedDocument, partial.revision)).json()).document.updatedAt, recoveredDocument.updatedAt);
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/test-research-report-recovery.ts', '--reopen', fixture], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr + child.stdout);
  console.log(JSON.stringify({ ok: true, paidCalls: 0, actualSsePlannerSave: true, interruptedDraftSaved: true, failedSaveRecoverable: true, saveOnlyRetry: true, conflictBeforeProvider: true, ownershipRefusals: true, freshProcessRestore: JSON.parse(child.stdout.trim()).freshProcessRestore, fixtureModelCalls: modelCalls }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
