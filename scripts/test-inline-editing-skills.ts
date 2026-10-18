import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';

// Real paper excerpt replayed only for engineering contracts; no paid inference.
const excerpt = 'In a third phase, we used the results obtained above to investigate the TTV signals themselves. By performing a series of analytical and numerical N-body integrations (see Methods), we could determine initial mass estimates for the six inner planets, along with their orbital eccentricities. We emphasise the preliminary nature of this dynamical solution which may not correspond to a global minimum of the parameter space, and that additional transit observations of the system will be required to lift the existing degeneracies (see Methods).';
async function main() {
  const skill = process.argv.includes('--review') ? 'peer-review' : 'text-polishing';
  const directory = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-inline-edit-'));
  const originalEnv = { ...process.env }, originalFetch = globalThis.fetch;
  const requests: Array<{ messages: Array<{ role: string; content: unknown }>; tools: Array<{ function: { name: string; parameters: { properties: Record<string, { type: string }> } } }> }> = [];
  const text = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value);
  let ordinary = false, negative = false;
  const gateway = createServer(async (request, response) => {
    const parts: Buffer[] = []; for await (const part of request) parts.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(parts).toString()); requests.push(body);
    const results = body.messages.filter((m: { role: string }) => m.role === 'tool');
    const viewer = body.tools.find((t: { function: { name: string } }) => /skill/i.test(t.function.name))?.function;
    let delta: Record<string, unknown>;
    if (!negative && !results.length && viewer) {
      const args = Object.fromEntries(Object.entries(viewer.parameters.properties).map(([key, value]) => [key, (value as { type: string }).type === 'array' ? [skill] : skill]));
      delta = { tool_calls: [{ index: 0, id: 'read-method', type: 'function', function: { name: viewer.name, arguments: JSON.stringify(args) } }] };
    } else if (!negative && ordinary && results.length === 1 && body.tools.some((t: { function: { name: string } }) => t.function.name === 'read_selected_evidence')) {
      delta = { tool_calls: [{ index: 0, id: 'read-original', type: 'function', function: { name: 'read_selected_evidence', arguments: JSON.stringify({ skill }) } }] };
    } else delta = { content: negative ? '已保留原段，本轮不改写或生成审查意见。' : skill === 'text-polishing' ? 'Analytical and numerical N-body integrations yielded preliminary mass estimates and orbital eccentricities for the six inner planets. The dynamical solution may not represent a global minimum; further transit observations are needed to resolve the degeneracies [1].' : '范围：仅审查本段动力学推断。原文已说明六颗内行星的质量估计为初步解，可能不是全局最小值。建议补充不同初值的收敛检验，并用后续凌日观测检验简并；这属于待补分析，不能称为已完成结果[1]。' };
    const frame = { id: 'inline-edit-replay', object: 'chat.completion.chunk', created: 1, model: 'fixture-flash', choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] };
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end('data: ' + JSON.stringify(frame) + '\n\ndata: ' + JSON.stringify({ ...frame, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' in delta ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  try {
    await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + (gateway.address() as AddressInfo).port;
    Object.assign(process.env, { NODE_ENV: 'test', SOURCE_STORE_ADAPTER: 'local-json', SOURCE_STORE_PATH: path.join(directory, 'sources.json'), STUDIO_DOCUMENT_STORE_DIR: path.join(directory, 'documents'), LOCAL_USAGE_QUOTA_PATH: path.join(directory, 'usage.json'), PAPER_HOST_SESSION_VERIFY_URL: 'https://editing-sms-fixture.invalid/session', OPENAI_COMPAT_API_BASE: origin + '/v1', OPENAI_COMPAT_API_KEY: 'fixture-key', OPENAI_COMPAT_MODEL: 'fixture-flash', ALLOW_INSECURE_API_BASE: 'true', ALLOW_PRIVATE_API_BASE: 'true', KNOWTRAIL_AGENT_PYTHON: originalEnv.KNOWTRAIL_AGENT_PYTHON || 'python3', KNOWTRAIL_OBSERVABILITY_HASH_KEY: 'editing-fixture-hash-key-at-least-32-characters', OPENAI_API_KEY: '', ARK_API_KEY: '', DASHSCOPE_API_KEY: '' });
    const book = 'editing-paper-170301424', now = '2026-10-18T11:00:00Z';
    const source = { id: 'editing-paper', ownerMemberId: 'paper-host:paper-user-' + 'a'.repeat(32), notebookId: book, fileName: '1703.01424v1-page3.txt', fileType: 'txt', title: 'Seven temperate terrestrial planets around TRAPPIST-1', authors: ['M. Gillon'], year: 2017, rawContent: excerpt, content: excerpt, abstract: '', shortName: 'Gillon 2017', status: 'succeeded', createdAt: now, updatedAt: now, stages: [], chunks: [{ id: 'editing-paper::chunk-1', sourceId: 'editing-paper', sourceIndex: 0, chunkIndex: 0, page: 3, paperShortName: 'Gillon 2017', sourceTitle: 'TRAPPIST-1 dynamics', text: excerpt, tokenEstimate: 170 }], chunkCount: 1, tokenEstimate: 170, vectorIndex: { status: 'not_configured', updatedAt: now } };
    await writeFile(path.join(directory, 'sources.json'), JSON.stringify({ version: 1, updatedAt: now, sources: [source] }));
    globalThis.fetch = async input => {
      assert.ok(String(input).startsWith('https://editing-sms-fixture.invalid/'), 'No paid or external request allowed');
      return Response.json({ data: { authenticated: true, provider: 'knowtrail', workspaceKey: 'paper-user-' + 'a'.repeat(32), capabilities: ['verified-sms-session'] } });
    };
    const { POST } = await import('../src/app/api/agent/chat/route');
    const headers = { 'Content-Type': 'application/json', Cookie: 'userId=fixture; token=fixture-valid-a' };
    const message = skill === 'text-polishing' ? '请润色所选论文第3页讨论TTV动力学解的段落，保留六颗内行星、初步解和简并限制，只给英文正文。' : '请审查所选论文第3页TTV动力学解段落的论证边界，区分原文已做与建议补做的分析，不改写原稿。';
    const send = (mode: string | undefined, notebookId = book, authenticated = true) => POST(new NextRequest('https://editing.invalid/api/agent/chat', { method: 'POST', headers: authenticated ? headers : { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: negative ? '先不要润色或审查，仅保留原段，稍后再处理。' : message, skill: mode, notebookId, papers: [{ id: source.id, rawContent: 'FORGED_CLIENT_CONTENT' }] }) }));
    const decode = async (response: Response) => {
      assert.equal(response.status, 200);
      const events = (await response.text()).split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)));
      assert.ok(!events.some(e => e.error), JSON.stringify(events));
      return { events, answer: events.reduce((answer: string, event) => typeof event.replaceContent === 'string' ? event.replaceContent : answer + (event.content || ''), '') };
    };
    const explicit = await decode(await send(skill));
    const loaded = requests.flatMap(r => r.messages.filter(m => m.role === 'tool').map(m => text(m.content))).join('\n');
    assert.ok(loaded.includes('## 执行步骤'), 'The actual SDK must consume the native reusable method, not a mode label');
    const initial = requests[0].messages.filter(m => m.role === 'system').map(m => text(m.content)).join('\n');
    assert.ok(initial.includes('global minimum') && initial.includes('existing degeneracies'), 'The complete verified original paragraph must reach the inline model');
    assert.ok(!initial.includes('FORGED_CLIENT_CONTENT'));
    assert.ok(requests.every(r => r.tools.every(t => /skill/i.test(t.function.name))), 'Explicit text modes must not expose artifact generators');
    ordinary = true;
    const beforeOrdinary = requests.length;
    const implicit = await decode(await send(undefined));
    assert.equal(implicit.answer, explicit.answer);
    assert.ok(requests.slice(beforeOrdinary).some(r => r.messages.some(m => m.role === 'tool' && text(m.content).includes('原文片段:'))), 'Ordinary intent must actually read verified evidence');
    negative = true;
    const none = await decode(await send(undefined));
    assert.ok(!none.events.some(e => e.toolCall));
    assert.match(none.answer, /本轮不改写/);
    const beforeDenied = requests.length;
    assert.equal((await send(skill, 'another-notebook')).status, 404);
    assert.equal((await send(skill, book, false)).status, 401);
    assert.equal(requests.length, beforeDenied, 'Ownership failures must be rejected before inference');
    const { PUT, GET } = await import('../src/app/api/studio/artifacts/route');
    const data = { mode: skill, draft: '', messages: [{ id: 'user-edit', role: 'user', content: message, timestamp: now }, { id: 'assistant-edit', role: 'assistant', content: explicit.answer, timestamp: now, citations: explicit.events.find(e => e.citations)?.citations || [] }] };
    const saved = await PUT(new NextRequest('https://editing.invalid/api/studio/artifacts?kind=chat-history', { method: 'PUT', headers, body: JSON.stringify({ notebookId: book, expectedRevision: null, data }) }));
    assert.equal(saved.status, 200, await saved.clone().text());
    const document = (await saved.json()).document;
    const conflict = await PUT(new NextRequest('https://editing.invalid/api/studio/artifacts?kind=chat-history', { method: 'PUT', headers, body: JSON.stringify({ notebookId: book, expectedRevision: null, data: { ...data, draft: '另一页面的未保存修改' } }) }));
    assert.equal(conflict.status, 409, 'An old page must not silently overwrite the saved editing result');
    for (const suffix of ['', '&revision=' + document.revision]) {
      const restored = await GET(new NextRequest('https://editing.invalid/api/studio/artifacts?kind=chat-history&notebookId=' + book + suffix, { headers }));
      assert.equal(restored.status, 200); assert.equal(restored.headers.get('Cache-Control'), 'private, no-store');
      assert.deepEqual((await restored.json()).document.data, data);
    }
    assert.equal(requests.length, beforeDenied, 'Saving and rereading must not trigger another model call');
    console.log(JSON.stringify({ ok: true, skill, actualSdk: 'agentscope==2.0.10', source: 'arXiv:1703.01424v1 PDF page 3', nativeMethodConsumed: true, explicitAndOrdinaryEvidence: true, ownershipRejectedBeforeModel: true, savedAndVersionReread: true, modelRequests: requests.length, paidCalls: 0, browserTested: false }));
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    await new Promise<void>(resolve => gateway.close(() => resolve()));
    assert.ok(path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('knowtrail-inline-edit-'));
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
