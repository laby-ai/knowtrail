import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';

type Event = Record<string, unknown>;
type ModelRequest = { messages: { role: string; content: unknown }[]; tools: { function: { name: string; parameters: { properties: Record<string, { type: string }> } } }[] };
const oversized = '软件模拟计时记录显示起点延迟61 ms；流程为导入27 toy_records，排除5条缺少标记记录，保留22条并人工复核[1]。该记录仅描述操作，非独立测量或真实性能证据，未运行性能比较[1]。\n\n（约80字内可再压缩：如需更短版本请告知。）';
const concise = '软件模拟：起点延迟61 ms；导入27 toy_records，剔除5条缺标记记录、保留22条；仅操作记录，非独立测量或性能证据，未运行性能比较[1]。';
const finalBody = (events: Event[]) => events.reduce((body, event) => typeof event.replaceContent === 'string' ? event.replaceContent : body + (typeof event.content === 'string' ? event.content : ''), '');

async function main() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-output-budget-'));
  const originalEnv = { ...process.env }, originalFetch = globalThis.fetch;
  let modelCalls = 0;
  const requests: ModelRequest[] = [];
  const gateway = createServer(async (request, response) => {
    const bytes: Buffer[] = []; for await (const part of request) bytes.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(bytes).toString()) as ModelRequest;
    requests.push(body); modelCalls++;
    const results = body.messages.filter(message => message.role === 'tool');
    const users = body.messages.filter(message => message.role === 'user');
    const user = JSON.stringify(users.map(message => message.content));
    let delta: Record<string, unknown>;
    if (user.includes('window-open') && !results.some(message => JSON.stringify(message.content).includes('window-ready'))) {
      delta = { tool_calls: [{ index: 0, id: 'open-only', type: 'function', function: { name: 'open_plugin', arguments: JSON.stringify({ plugin: 'presentation', request: '只打开已有PPT窗口' }) } }] };
    } else if (!results.length) {
      const viewer = body.tools.find(tool => /skill/i.test(tool.function.name))!.function;
      const args = Object.fromEntries(Object.entries(viewer.parameters.properties).map(([key, value]) => [key, value.type === 'array' ? ['academic-writing'] : 'academic-writing']));
      delta = { content: '准备读取，不属于最终正文。', tool_calls: [{ index: 0, id: 'read-method', type: 'function', function: { name: viewer.name, arguments: JSON.stringify(args) } }] };
    } else if (results.length === 1 && body.tools.some(tool => tool.function.name === 'read_selected_evidence')) {
      delta = { tool_calls: [{ index: 0, id: 'read-evidence', type: 'function', function: { name: 'read_selected_evidence', arguments: JSON.stringify({ skill: 'academic-writing' }) } }] };
    } else {
      delta = { content: user.includes('oversized') ? oversized : concise };
    }
    const frame = (content: Record<string, unknown>, reason: string | null = null) => 'data: ' + JSON.stringify({ id: 'bounded-text-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', ...content }, finish_reason: reason }] }) + '\n\n';
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end(frame(delta) + frame({}, 'tool_calls' in delta ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n');
  });
  try {
    await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
    Object.assign(process.env, { NODE_ENV: 'test', SOURCE_STORE_ADAPTER: 'local-json', SOURCE_STORE_PATH: path.join(directory, 'sources.json'), STUDIO_DOCUMENT_STORE_DIR: path.join(directory, 'documents'), LOCAL_USAGE_QUOTA_PATH: path.join(directory, 'usage.json'), PAPER_HOST_SESSION_VERIFY_URL: 'https://output-sms-fixture.invalid/session', OPENAI_COMPAT_API_BASE: 'http://127.0.0.1:' + (gateway.address() as AddressInfo).port + '/v1', OPENAI_COMPAT_API_KEY: 'fixture-key', OPENAI_COMPAT_MODEL: 'qwen3.8-flash', ALLOW_INSECURE_API_BASE: 'true', ALLOW_PRIVATE_API_BASE: 'true', KNOWTRAIL_AGENT_PYTHON: originalEnv.KNOWTRAIL_AGENT_PYTHON || 'python3', KNOWTRAIL_OBSERVABILITY_HASH_KEY: 'ordinary-output-fixture-at-least-32-characters', OPENAI_API_KEY: '', ARK_API_KEY: '', DASHSCOPE_API_KEY: '' });
    const owner = 'paper-host:paper-user-' + 'a'.repeat(32), book = 'ordinary-output-fixture', id = 'ordinary-output-source', now = new Date().toISOString();
    const raw = '软件模拟计时记录：起点延迟61 ms。导入27 toy_records，剔除5条缺标记记录，保留22条并人工复核。仅描述操作，非独立测量或真实性能证据。未运行性能比较。';
    await writeFile(path.join(directory, 'sources.json'), JSON.stringify({ version: 1, updatedAt: now, sources: [{ id, ownerMemberId: owner, notebookId: book, fileName: id + '.txt', fileType: 'txt', title: '篇幅验收专用模拟记录', authors: [], rawContent: raw, content: raw, abstract: raw, shortName: id, status: 'succeeded', createdAt: now, updatedAt: now, stages: [], chunks: [{ id: id + '::chunk-1', sourceId: id, sourceIndex: 0, chunkIndex: 0, paperShortName: id, sourceTitle: id, text: raw, tokenEstimate: 100 }], chunkCount: 1, tokenEstimate: 100, vectorIndex: { status: 'not_configured', updatedAt: now } }] }));
    globalThis.fetch = async input => {
      assert.ok(String(input).startsWith('https://output-sms-fixture.invalid/'), 'No external model or identity request');
      return Response.json({ data: { authenticated: true, provider: 'knowtrail', workspaceKey: 'paper-user-' + 'a'.repeat(32), capabilities: ['verified-sms-session'] } });
    };
    const { POST } = await import('../src/app/api/agent/chat/route');
    const send = async (message: string, skill?: string) => {
      const response = await POST(new NextRequest('https://output-fixture.invalid/api/agent/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'userId=fixture; token=fixture-session' }, signal: AbortSignal.timeout(25_000), body: JSON.stringify({ message, skill, notebookId: book, papers: [{ id }] }) }));
      assert.equal(response.status, 200);
      return (await response.text()).split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)) as Event);
    };
    const failure = await send('oversized：根据所选软件模拟记录写一段结果说明，80字以内，保留数字、单位和限定。不生成文件。');
    assert.equal(finalBody(failure), oversized, 'The regression fixture must reproduce the actual 118-character final body');
    const error = failure.find(event => typeof event.error === 'string');
    assert.ok(error, 'An over-budget final reply must not finish as a successful answer');
    assert.match(String(error.error), /118.*80/);
    assert.ok(String(error.error).includes(oversized), 'The failed draft remains readable, with no numeric truncation');
    assert.equal(modelCalls, 3, 'No automatic paid repair or retry');
    assert.ok(!failure.some(event => event.citationAudit), 'An over-budget draft cannot get the successful final audit');
    const normal = await send('concise：基于所选模拟记录写一段结果说明，80字以内，保留数字、单位及限定。');
    assert.ok(!normal.some(event => event.error)); assert.equal(finalBody(normal), concise);
    assert.ok([...concise.replace(/\s/g, '')].length <= 80);
    assert.ok(normal.some(event => event.citationAudit));
    assert.ok(!finalBody(normal).includes('准备读取'));
    const inline = await send('concise：写一段80字以内的结果说明，保留所有数字和软件模拟的限定。', 'academic-writing');
    assert.ok(!inline.some(event => event.error)); assert.equal(finalBody(inline), concise);
    const inlineFailure = await send('oversized：写一段80字以内的结果说明，保留所有数字和软件模拟的限定。', 'academic-writing');
    assert.ok(inlineFailure.some(event => typeof event.error === 'string' && /118.*80/.test(event.error)), 'Inline final messages must also be validated after SDK completion');
    const opened = await send('window-open oversized：只打开PPT窗口，解释控制在80字以内。');
    assert.ok(opened.some(event => typeof event.error === 'string' && /118.*80/.test(event.error)), 'Opening a window does not exempt the final prose from its budget');
    const local = await send('oversized：写两段结果说明，每段80字以内。');
    assert.ok(!local.some(event => event.error), 'A local paragraph budget is not a whole-answer budget');
    const unlimited = await send('oversized：依据所选记录说明操作与局限。');
    assert.ok(!unlimited.some(event => event.error)); assert.equal(finalBody(unlimited), oversized);
    console.log(JSON.stringify({ ok: true, realSdk: 'agentscope==2.0.10', replayedFailureChars: 118, acceptedChars: [...concise.replace(/\s/g, '')].length, overBudgetNotComplete: true, draftPreserved: true, noAutomaticRetry: true, sourceRead: true, inlineAndOrdinary: true, localBudgetNotGlobal: true, paidCalls: 0, modelCalls, requests: requests.length }));
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv);
    await new Promise<void>(resolve => gateway.close(() => resolve()));
    assert.ok(path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('knowtrail-output-budget-'));
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
