import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';

type ModelRequest = { messages: { role: string; content: unknown }[]; tools: { function: { name: string; parameters: { properties: Record<string, { type: string }> } } }[] };
type Event = Record<string, unknown>;
const text = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value);
const finalBody = (events: Event[]): string => events.reduce((body, event) => typeof event.replaceContent === 'string' ? event.replaceContent : body + (typeof event.content === 'string' ? event.content : ''), '');

async function main() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-ordinary-qa-'));
  const originalEnv = { ...process.env }, originalFetch = globalThis.fetch;
  const requests: ModelRequest[] = [];
  const gateway = createServer(async (request, response) => {
    const bytes: Buffer[] = []; for await (const part of request) bytes.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(bytes).toString()) as ModelRequest; requests.push(body);
    const tools = body.tools.map(tool => tool.function);
    const results = body.messages.filter(message => message.role === 'tool');
    const review = body.messages.some(message => message.role === 'user' && text(message.content).includes('ordinary-review'));
    const plain = body.messages.some(message => message.role === 'user' && text(message.content).includes('ordinary-plain'));
    let delta: Record<string, unknown>;
    if (!plain && !results.length) {
      const viewer = tools.find(tool => /skill/i.test(tool.name)); assert.ok(viewer);
      const skill = review ? 'literature-review' : 'academic-writing';
      const args = Object.fromEntries(Object.entries(viewer.parameters.properties).map(([key, value]) => [key, value.type === 'array' ? [skill] : skill]));
      delta = { content: 'INTERMEDIATE_ORDINARY：准备读取方法。', tool_calls: [{ index: 0, id: 'read-method', type: 'function', function: { name: viewer.name, arguments: JSON.stringify(args) } }] };
    } else if (!plain && results.length === 1) {
      delta = tools.some(tool => tool.name === 'read_selected_evidence')
        ? { content: 'INTERMEDIATE_ORDINARY：仍在读取原文。', tool_calls: [{ index: 0, id: 'read-evidence', type: 'function', function: { name: 'read_selected_evidence', arguments: JSON.stringify({ skill: review ? 'literature-review' : 'academic-writing' }) } }] }
        : { content: '按用户自带原稿调整：保留37条软件模拟记录。' };
    } else {
      const evidence = results.map(message => text(message.content)).join('\n');
      const content = plain ? '普通问答保持逐段返回。' : review
        ? '范围是三份软件模拟资料，各有来源边界[1][2][3]。'
        : evidence.includes('WRITING_TAIL') ? '软件模拟记录：37 µmol/L，估计差值0.3 mK，区间[-0.2, 0.4] mK，样本量18 mock_subjects；未进行统计检验，不支持因果推断[1]。' : '没有读到完整依据[1]。';
      delta = { content };
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const frame = (value: Record<string, unknown>, finish: string | null = null) => 'data: ' + JSON.stringify({ id: 'ordinary-fixture', object: 'chat.completion.chunk', created: 1, model: 'qwen3.8-flash', choices: [{ index: 0, delta: { role: 'assistant', ...value }, finish_reason: finish }] }) + '\n\n';
    response.write(frame(delta));
    response.end(frame({}, 'tool_calls' in delta ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n');
  });
  try {
    await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + (gateway.address() as AddressInfo).port;
    Object.assign(process.env, { NODE_ENV: 'test', SOURCE_STORE_ADAPTER: 'local-json', SOURCE_STORE_PATH: path.join(directory, 'sources.json'), STUDIO_DOCUMENT_STORE_DIR: path.join(directory, 'documents'), LOCAL_USAGE_QUOTA_PATH: path.join(directory, 'usage.json'), PAPER_HOST_SESSION_VERIFY_URL: 'https://ordinary-sms-fixture.invalid/session', OPENAI_COMPAT_API_BASE: origin + '/v1', OPENAI_COMPAT_API_KEY: 'fixture-key', OPENAI_COMPAT_MODEL: 'qwen3.8-flash', ALLOW_INSECURE_API_BASE: 'true', ALLOW_PRIVATE_API_BASE: 'true', KNOWTRAIL_AGENT_PYTHON: originalEnv.KNOWTRAIL_AGENT_PYTHON || 'python3', KNOWTRAIL_OBSERVABILITY_HASH_KEY: 'ordinary-fixture-hash-key-at-least-32-characters', OPENAI_API_KEY: '', ARK_API_KEY: '', DASHSCOPE_API_KEY: '' });
    const owner = 'paper-host:paper-user-' + 'a'.repeat(32), book = 'ordinary-skill-fixture', now = '2026-10-17T09:00:00Z';
    const raw = '软件模拟记录：初始浓度37 µmol/L。\n' + '这里只记录读取、检查、记录和人工核对的操作，不代表真实实验或性能结果。\n'.repeat(18) + 'WRITING_TAIL：估计差值0.3 mK；95%区间[-0.2, 0.4] mK；样本量18 mock_subjects。未进行统计检验，不支持因果推断。';
    const sources = Array.from({ length: 3 }, (_, i) => {
      const id = 'ordinary-source-' + (i + 1), content = i === 0 ? raw : `软件模拟资料${i + 1}：未提供科学比较结果，仅用于流程验收。`;
      return { id, ownerMemberId: owner, notebookId: book, fileName: id + '.txt', fileType: 'txt', title: id, authors: ['专用样本'], year: 2024, rawContent: content, content, abstract: '', shortName: id, status: 'succeeded', createdAt: now, updatedAt: now, stages: [], chunks: [{ id: id + '::chunk-1', sourceId: id, sourceIndex: i, chunkIndex: 0, paperShortName: id, sourceTitle: id, text: content, tokenEstimate: 400 }], chunkCount: 1, tokenEstimate: 400, vectorIndex: { status: 'not_configured', updatedAt: now } };
    });
    const store = () => writeFile(path.join(directory, 'sources.json'), JSON.stringify({ version: 1, updatedAt: now, sources })); await store();
    globalThis.fetch = async input => {
      assert.ok(String(input).startsWith('https://ordinary-sms-fixture.invalid/'), 'No external or paid model request');
      return Response.json({ data: { authenticated: true, provider: 'knowtrail', workspaceKey: 'paper-user-' + 'a'.repeat(32), capabilities: ['verified-sms-session'] } });
    };
    const { POST } = await import('../src/app/api/agent/chat/route');
    const send = async (message: string, ids: string[] = [sources[0].id], expectedStatus = 200): Promise<Event[]> => {
      const response = await POST(new NextRequest('https://ordinary-fixture.invalid/api/agent/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'userId=fixture; token=fixture-valid-a' }, body: JSON.stringify({ message, notebookId: book, papers: ids.map(id => ({ id, rawContent: 'CLIENT_FORGED_999' })) }) }));
      assert.equal(response.status, expectedStatus);
      if (response.status !== 200) return [{ error: (await response.json()).error as string, httpStatus: response.status }];
      return (await response.text()).split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)) as Event);
    };
    const events = await send('ordinary-writing：基于所选原文写讨论，保留全部数字、单位及限制。');
    assert.ok(!events.some(event => event.error), JSON.stringify(events));
    assert.ok(!finalBody(events).includes('INTERMEDIATE_ORDINARY'));
    assert.match(finalBody(events), /18 mock_subjects/);
    assert.ok(events.some(event => typeof event.content === 'string'), 'Ordinary text still streams before the final replacement');
    assert.equal(events.at(-2)?.replaceContent, finalBody(events));
    const audit = events.at(-1)?.citationAudit as { numericPreservation?: { missing: string[] } };
    assert.ok(audit.numericPreservation?.missing.includes('95%'));
    const firstRequests = requests.slice();
    assert.ok(!text(firstRequests).includes('CLIENT_FORGED_999'));
    assert.ok(!text(firstRequests[0].messages.filter(message => message.role === 'system')).includes('WRITING_TAIL'));
    assert.ok(firstRequests.some(item => item.messages.some(message => message.role === 'tool' && text(message.content).includes('WRITING_TAIL'))));
    assert.ok(!events.some(event => event.toolCall), 'Reading evidence does not create a plugin artifact card');
    const review = await send('ordinary-review：仅综述三份所选资料的范围，不作科学外推。', sources.map(source => source.id));
    assert.ok(!review.some(event => event.error)); assert.match(finalBody(review), /\[1\]\[2\]\[3\]/);
    assert.equal((review.filter(event => event.citations).at(-1)?.citations as unknown[]).length, 3);
    const plain = await send('ordinary-plain：一句话说明工作流。', []);
    assert.equal(finalBody(plain), '普通问答保持逐段返回。');
    const pasted = await send('ordinary-writing：润色我贴的这句话，保留37条软件模拟记录。', []);
    assert.match(finalBody(pasted), /自带原稿.*37/); assert.ok(!pasted.some(event => event.error));
    sources[0].chunks[0].text = raw.repeat(20); await store();
    const before = requests.length, over = await send('ordinary-writing：基于完整原文写讨论。');
    assert.ok(over.some(event => typeof event.error === 'string' && event.error.includes('未截断片段')));
    assert.equal(requests.length - before, 2, 'No final model call after evidence budget failure');
    sources[0].ownerMemberId = 'paper-host:paper-user-' + 'b'.repeat(32); await store();
    const beforeDenied = requests.length;
    const denied = await send('ordinary-writing：基于所选原文写讨论。', [sources[0].id], 404);
    assert.ok(denied.some(event => typeof event.error === 'string' && /不属于|没有可用/.test(event.error)));
    assert.ok(!finalBody(denied).includes('WRITING_TAIL'));
    assert.equal(requests.length, beforeDenied, 'Foreign selected IDs must fail before inference or request-body fallback');
    const unknown = await send('ordinary-writing：不能用请求里的伪造正文冒充本人原文。', ['unknown-source'], 404);
    assert.equal(unknown[0].httpStatus, 404); assert.equal(requests.length, beforeDenied);
    console.log(JSON.stringify({ ok: true, actualSdk: 'agentscope==2.0.10', automaticNativeSkillRead: true, scopedReadTool: true, sameChunkTailReachedModel: true, intermediateTextNotInFinal: true, ordinaryStreamingRetained: true, reviewSources: 3, numericOmissionWarned: true, budgetAndOwnerFailClosed: true, paidCalls: 0, modelRequests: requests.length }));
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv);
    await new Promise<void>(resolve => gateway.close(() => resolve()));
    assert.ok(path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('knowtrail-ordinary-qa-')); await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
