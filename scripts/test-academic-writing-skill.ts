import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';

async function main() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-writing-qa-'));
  const originalEnv = { ...process.env }, originalFetch = globalThis.fetch;
  const baseline = process.argv.includes('--expect-truncated');
  const expectIntermediate = process.argv.includes('--expect-intermediate');
  const requests: { messages: { role: string; content: unknown }[]; tools: { function: { name: string; parameters: { properties: Record<string, { type: string }> } } }[]; model: string }[] = [];
  const text = (content: unknown): string => typeof content === 'string' ? content : JSON.stringify(content);
  const gateway = createServer(async (request, response) => {
    const parts: Buffer[] = []; for await (const part of request) parts.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(parts).toString()); requests.push(body);
    assert.equal(body.model, 'qwen3.8-flash');
    const results = body.messages.filter((m: { role: string }) => m.role === 'tool');
    let delta: Record<string, unknown>;
    if (!results.length) {
      const viewer = body.tools.find((t: { function: { name: string } }) => /skill/i.test(t.function.name))?.function;
      assert.ok(viewer, 'Native Skill reader must be available');
      const args = Object.fromEntries(Object.entries(viewer.parameters.properties).map(([key, value]) => [key, (value as { type: string }).type === 'array' ? ['academic-writing'] : 'academic-writing']));
      delta = { tool_calls: [{ index: 0, id: 'read-writing-skill', type: 'function', function: { name: viewer.name, arguments: JSON.stringify(args) } }] };
    } else if (results.length === 1) {
      const viewer = body.tools.find((t: { function: { name: string } }) => /skill/i.test(t.function.name))?.function;
      assert.ok(viewer);
      const args = Object.fromEntries(Object.entries(viewer.parameters.properties).map(([key, value]) => [key, (value as { type: string }).type === 'array' ? ['academic-writing'] : 'academic-writing']));
      delta = { content: 'INTERMEDIATE_WRITING_DRAFT：工具阶段的中间文本，不是最终正文。', tool_calls: [{ index: 0, id: 'read-writing-skill-again', type: 'function', function: { name: viewer.name, arguments: JSON.stringify(args) } }] };
    } else {
      const context = body.messages.filter((m: { role: string }) => m.role === 'system').map((m: { content: unknown }) => text(m.content)).join('\n');
      delta = { content: context.includes('WRITING_TAIL') ? '这是软件模拟记录：初始浓度37 µmol/L，样本量18 mock_subjects；估计差值0.3 mK，95%区间[-0.2, 0.4] mK。未进行统计检验，不支持因果推断或方法优劣判断[1]。' : '当前片段只显示初始浓度37 µmol/L；没有给出差值、区间和样本量，不能补写[1]。' };
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const frame = { id: 'writing-fixture', object: 'chat.completion.chunk', created: 1, model: 'qwen3.8-flash', choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] };
    response.end('data: ' + JSON.stringify(frame) + '\n\ndata: ' + JSON.stringify({ ...frame, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' in delta ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  try {
    await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + (gateway.address() as AddressInfo).port;
    Object.assign(process.env, { NODE_ENV: 'test', SOURCE_STORE_ADAPTER: 'local-json', SOURCE_STORE_PATH: path.join(directory, 'sources.json'), STUDIO_DOCUMENT_STORE_DIR: path.join(directory, 'documents'), LOCAL_USAGE_QUOTA_PATH: path.join(directory, 'usage.json'), PAPER_HOST_SESSION_VERIFY_URL: 'https://writing-sms-fixture.invalid/session', OPENAI_COMPAT_API_BASE: origin + '/v1', OPENAI_COMPAT_API_KEY: 'fixture-key', OPENAI_COMPAT_MODEL: 'qwen3.8-flash', ALLOW_INSECURE_API_BASE: 'true', ALLOW_PRIVATE_API_BASE: 'true', KNOWTRAIL_AGENT_PYTHON: originalEnv.KNOWTRAIL_AGENT_PYTHON || 'python3', KNOWTRAIL_OBSERVABILITY_HASH_KEY: 'writing-fixture-hash-key-at-least-32-characters', OPENAI_API_KEY: '', ARK_API_KEY: '', DASHSCOPE_API_KEY: '' });
    const owner = 'paper-host:paper-user-' + 'a'.repeat(32), book = 'writing-skill-fixture', now = '2026-10-17T08:00:00Z';
    const raw = '软件模拟记录：初始浓度37 µmol/L。以下为同一片段内的过程记录，不是额外测量或真实科研结果。\n' + '过程记录仅说明软件测试的操作顺序：读取、检查、记录和人工核对；没有新增数值。\n'.repeat(18) + '\nWRITING_TAIL：估计差值0.3 mK；95%区间[-0.2, 0.4] mK；样本量18 mock_subjects。未进行统计检验，不支持因果推断或方法优劣判断。';
    const source = { id: 'writing-source-1', ownerMemberId: owner, notebookId: book, fileName: 'writing-record.txt', fileType: 'txt', title: '软件模拟写作记录', authors: ['专用样本'], year: 2024, rawContent: raw, content: raw, abstract: '', shortName: '写作模拟记录', status: 'succeeded', createdAt: now, updatedAt: now, stages: [], chunks: [{ id: 'writing-source-1::chunk-1', sourceId: 'writing-source-1', sourceIndex: 0, chunkIndex: 0, paperShortName: '写作模拟记录', sourceTitle: '软件模拟写作记录', text: raw, tokenEstimate: 400 }], chunkCount: 1, tokenEstimate: 400, vectorIndex: { status: 'not_configured', updatedAt: now } };
    await writeFile(path.join(directory, 'sources.json'), JSON.stringify({ version: 1, updatedAt: now, sources: [source] }));
    globalThis.fetch = async input => {
      assert.ok(String(input).startsWith('https://writing-sms-fixture.invalid/'), 'No paid or external host tool call allowed');
      return Response.json({ data: { authenticated: true, provider: 'knowtrail', workspaceKey: 'paper-user-' + 'a'.repeat(32), capabilities: ['verified-sms-session'] } });
    };
    const { POST } = await import('../src/app/api/agent/chat/route');
    const response = await POST(new NextRequest('https://writing-fixture.invalid/api/agent/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'userId=fixture; token=fixture-valid-a' }, body: JSON.stringify({ message: '基于所选软件模拟记录写一段讨论，保留原记录全部数字、单位、区间和限制条件，不推因果，不改证据强度，正文150字以内。', skill: 'academic-writing', notebookId: book, papers: [{ id: source.id, rawContent: 'CLIENT_FORGED_999' }] }) }));
    assert.equal(response.status, 200);
    const stream = await response.text();
    const events = stream.split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)));
    assert.ok(events.some(e => e.engine === 'agentscope')); assert.ok(!events.some(e => e.error), JSON.stringify(events));
    const answer = events.map(e => e.content || '').join('');
    assert.equal(answer.includes('INTERMEDIATE_WRITING_DRAFT'), expectIntermediate, 'Only the final SDK message belongs in the saved writing body');
    const context = requests[0].messages.filter(m => m.role === 'system').map(m => text(m.content)).join('\n');
    const loaded = requests.flatMap(r => r.messages.filter(m => m.role === 'tool').map(m => text(m.content))).join('\n');
    assert.ok(!context.includes('CLIENT_FORGED_999')); assert.ok(context.includes('37 µmol/L'));
    const hasTail = context.includes('WRITING_TAIL') && context.includes('[-0.2, 0.4]') && context.includes('18 mock_subjects');
    if (baseline) assert.equal(hasTail, false, 'The baseline hypothesis must be falsifiable');
    else { assert.ok(hasTail); assert.ok(loaded.includes('写作依据')); assert.ok(requests.every(r => r.tools.every(t => /skill/i.test(t.function.name)))); }
    if (!baseline) {
      const before = requests.length;
      const send = (notebookId = book) => POST(new NextRequest('https://writing-fixture.invalid/api/agent/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'userId=fixture; token=fixture-valid-a' }, body: JSON.stringify({ message: '基于所选原文写一段讨论。', skill: 'academic-writing', notebookId, papers: [{ id: source.id, rawContent: 'CLIENT_FORGED_999' }] }) }));
      assert.equal((await send('other-book')).status, 404);
      const { expandAcademicWritingEvidence, auditAcademicWriting } = await import('../src/lib/academic-writing-evidence');
      const citations = events.find(e => e.citations)?.citations || [];
      const omitted = auditAcademicWriting('估计差值0.3 mK，区间[-0.2, 0.4] mK[1]。', citations, '保留原文全部数字和限定。', ['0.3', '95%', '-0.2', '0.4']);
      assert.equal(omitted.status, 'needs-review'); assert.deepEqual(omitted.numericPreservation?.missing, ['95%']); assert.match(omitted.warning || '', /95%/);
      assert.equal(auditAcademicWriting('区间[-0.2, 0.4] mK[1]。', citations, '挑重点写一段讨论。', ['95%']).status, 'pass');
      assert.equal(auditAcademicWriting('95％区间[−0.2, 0.4] mK[1]。', citations, '保留全部数字。', ['95%', '-0.2', '0.4']).status, 'pass');
      const forged = auditAcademicWriting('区间[95]。', citations, '保留全部数字。', ['95%']); assert.equal(forged.status, 'invalid-markers'); assert.deepEqual(forged.numericPreservation?.missing, ['95%']);
      await assert.rejects(expandAcademicWritingEvidence({ chunks: [], citations: [{ ...citations[0], chunkId: 'missing-original-chunk' }], promptContext: '', retrievalMode: 'persisted-keyword', persistedSourceCount: 1, vectorIndexedSourceCount: 0, degraded: false }, { ownerMemberId: owner, notebookId: book }), /原文片段尚未就绪/);
      await writeFile(path.join(directory, 'sources.json'), JSON.stringify({ version: 1, updatedAt: now, sources: [{ ...source, chunks: source.chunks.map(c => ({ ...c, text: raw.repeat(20) })) }] }));
      const over = await send(); assert.equal(over.status, 422); assert.match((await over.json()).error, /未截断片段/);
      await writeFile(path.join(directory, 'sources.json'), JSON.stringify({ version: 1, updatedAt: now, sources: [] }));
      assert.equal((await send()).status, 404, 'Caller-supplied body cannot replace a missing owned source');
      assert.equal(requests.length, before, 'Unowned, missing and oversized evidence must not invoke a model');
    }
    console.log(JSON.stringify({ ok: true, baselineDefect: baseline, actualSdk: 'agentscope==2.0.10', rawChars: raw.length, sameChunkTailReachedModel: hasTail, intermediateTextHidden: !answer.includes('INTERMEDIATE_WRITING_DRAFT'), nativeSkillRead: loaded.includes('学术写作'), loadedSkillChars: loaded.length, modelRequests: requests.length, paidCalls: 0, forgedClientTextExcluded: true, stream }));
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    await new Promise<void>(resolve => gateway.close(() => resolve()));
    assert.ok(path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('knowtrail-writing-qa-'));
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
