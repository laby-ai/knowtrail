import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';

async function main() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-review-qa-'));
  const originalEnv = { ...process.env }, originalFetch = globalThis.fetch;
  const expectTruncated = process.argv.includes('--expect-truncated');
  const requests: { messages: { role: string; content: unknown }[]; model: string; tools?: { function: { name: string; parameters: { properties: Record<string, { type: string }> } } }[] }[] = [];
  const text = (content: unknown): string => typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part?.text || '').join('') : JSON.stringify(content);
  const gateway = createServer(async (request, response) => {
    const parts: Buffer[] = []; for await (const part of request) parts.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(parts).toString()); requests.push(body);
    assert.equal(body.model, 'qwen3.8-flash');
    if (!expectTruncated) assert.ok(body.tools.every((tool: { function: { name: string } }) => /skill/i.test(tool.function.name)), 'Inline reviews must not expose unrelated generation tools');
    const results = body.messages.filter((m: { role: string }) => m.role === 'tool');
    let delta: Record<string, unknown>;
    if (!results.length) {
      const viewer = body.tools.find((t: { function: { name: string } }) => /skill/i.test(t.function.name))?.function;
      assert.ok(viewer, 'The actual SDK must expose a native Skill reader');
      const args = Object.fromEntries(Object.entries(viewer.parameters.properties).map(([key, value]) => [key, (value as { type: string }).type === 'array' ? ['literature-review'] : 'literature-review']));
      delta = { tool_calls: [{ index: 0, id: 'read-review-skill', type: 'function', function: { name: viewer.name, arguments: JSON.stringify(args) } }] };
    } else {
      const system = body.messages.filter((m: { role: string }) => m.role === 'system').map((m: { content: unknown }) => text(m.content)).join('\n');
      const ids = [...new Set([...system.matchAll(/sourceId:\s*(review-source-\d+)/g)].map(x => x[1]))];
      delta = { content: `软件验收：以下仅基于${ids.length}份来源片段，不声称核验全文。\n` + ids.map((id, i) => `- ${id}已列入本轮证据对照[${i + 1}]。`).join('\n') };
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const frame = { id: 'review-fixture', object: 'chat.completion.chunk', created: 1, model: 'qwen3.8-flash', choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] };
    response.end('data: ' + JSON.stringify(frame) + '\n\ndata: ' + JSON.stringify({ ...frame, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' in delta ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  try {
    await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + (gateway.address() as AddressInfo).port;
    Object.assign(process.env, { NODE_ENV: 'test', SOURCE_STORE_ADAPTER: 'local-json', SOURCE_STORE_PATH: path.join(directory, 'sources.json'), STUDIO_DOCUMENT_STORE_DIR: path.join(directory, 'documents'), LOCAL_USAGE_QUOTA_PATH: path.join(directory, 'usage.json'), PAPER_HOST_SESSION_VERIFY_URL: 'https://review-sms-fixture.invalid/session', OPENAI_COMPAT_API_BASE: origin + '/v1', OPENAI_COMPAT_API_KEY: 'fixture-key', OPENAI_COMPAT_MODEL: 'qwen3.8-flash', ALLOW_INSECURE_API_BASE: 'true', ALLOW_PRIVATE_API_BASE: 'true', KNOWTRAIL_AGENT_PYTHON: originalEnv.KNOWTRAIL_AGENT_PYTHON || 'python3', KNOWTRAIL_OBSERVABILITY_HASH_KEY: 'review-fixture-hash-key-at-least-32-characters', OPENAI_API_KEY: '', ARK_API_KEY: '', DASHSCOPE_API_KEY: '' });
    const owner = 'paper-host:paper-user-' + 'a'.repeat(32), book = 'review-skill-fixture', now = '2026-10-17T08:00:00Z';
    const sources = Array.from({ length: 10 }, (_, i) => {
      const id = 'review-source-' + String(i + 1).padStart(2, '0');
      const raw = `软件综述专用记录 ${i + 1}。方案${i % 2 ? '乙' : '甲'}在条件${i < 5 ? 'X' : 'Y'}保留${10 + i}个mock_records。没有统计显著性、性能和真实科研结论。`;
      return { id, ownerMemberId: owner, notebookId: book, fileName: id + '.txt', fileType: 'txt', title: '软件综述专用记录 ' + (i + 1), authors: ['专用样本'], year: 2024, rawContent: raw, content: raw, abstract: raw, shortName: id, status: 'succeeded', createdAt: now, updatedAt: now, stages: [], chunks: [{ id: id + '::chunk-1', sourceId: id, sourceIndex: i, chunkIndex: 0, paperShortName: id, sourceTitle: '软件综述专用记录 ' + (i + 1), text: raw, tokenEstimate: 40 }], chunkCount: 1, tokenEstimate: 40, vectorIndex: { status: 'not_configured', updatedAt: now } };
    });
    await mkdir(path.join(directory, 'documents'));
    await writeFile(path.join(directory, 'sources.json'), JSON.stringify({ version: 1, updatedAt: now, sources }));
    globalThis.fetch = async (input) => {
      assert.ok(String(input).startsWith('https://review-sms-fixture.invalid/'), 'No external service or paid model request is permitted');
      return Response.json({ data: { authenticated: true, provider: 'knowtrail', workspaceKey: 'paper-user-' + 'a'.repeat(32), capabilities: ['verified-sms-session'] } });
    };
    const { POST } = await import('../src/app/api/agent/chat/route');
    const response = await POST(new NextRequest('https://review-fixture.invalid/api/agent/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'userId=fixture; token=fixture-valid-a' }, body: JSON.stringify({ message: '对所选10份软件综述专用记录逐篇对比，保留每份编号和限定，不当科研结果。', skill: 'literature-review', notebookId: book, papers: sources.map(s => ({ id: s.id, rawContent: 'CLIENT_FORGED_999' })) }) }));
    assert.equal(response.status, 200);
    const stream = await response.text();
    const events = stream.split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)));
    assert.ok(events.some(e => e.engine === 'agentscope')); assert.ok(!events.some(e => e.error), JSON.stringify(events));
    const citations = events.find(e => e.citations)?.citations || [];
    const allSystem = requests[0].messages.filter(m => m.role === 'system').map(m => text(m.content)).join('\n');
    const modelSourceIds = [...new Set([...allSystem.matchAll(/sourceId:\s*(review-source-\d+)/g)].map(x => x[1]))];
    const loadedSkill = requests.flatMap(r => r.messages.filter(m => m.role === 'tool').map(m => text(m.content))).join('\n');
    const hasReviewMethod = loadedSkill.includes('证据对照') && loadedSkill.includes('逐篇') && loadedSkill.includes('分歧');
    assert.ok(loadedSkill.includes('文献综述')); assert.ok(!allSystem.includes('CLIENT_FORGED_999'));
    if (expectTruncated) { assert.ok(modelSourceIds.length < sources.length); assert.equal(citations.length, modelSourceIds.length); assert.equal(hasReviewMethod, false); }
    else { assert.deepEqual(new Set(modelSourceIds), new Set(sources.map(s => s.id))); assert.equal(citations.length, 10); assert.ok(hasReviewMethod); }
    if (!expectTruncated) {
      const audit = events.find(e => e.citationAudit)?.citationAudit;
      assert.equal(audit.status, 'pass'); assert.equal(audit.uncitedNumbers.length, 0);
      assert.deepEqual(audit.sourceCoverage, { covered: 10, total: 10 });
      const { auditLiteratureReviewCoverage } = await import('../src/lib/literature-review-evidence');
      const partial = auditLiteratureReviewCoverage('仅谈第一份[1]。\n## 参考文献\n' + citations.map((_: unknown, i: number) => `[${i + 1}]`).join(' '), citations);
      assert.equal(partial.status, 'missing-markers'); assert.equal(partial.uncitedNumbers.length, 9); assert.match(partial.warning || '', /正文未涵盖全部10份/);
      assert.deepEqual(partial.sourceCoverage, { covered: 1, total: 10 });
      assert.equal(auditLiteratureReviewCoverage('不存在的编号[99]。', citations).status, 'invalid-markers');
      assert.equal(auditLiteratureReviewCoverage('## 参考文献\n列表[1]\n## 证据对照\n' + citations.map((_: unknown, i: number) => `来源比较[${i + 1}]。`).join('\n'), citations).status, 'pass');
      const beforeRejected = requests.length;
      const send = (papers: unknown[], notebookId = book) => POST(new NextRequest('https://review-fixture.invalid/api/agent/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'userId=fixture; token=fixture-valid-a' }, body: JSON.stringify({ message: '逐篇综述软件专用记录。', skill: 'literature-review', notebookId, papers }) }));
      assert.equal((await send([])).status, 400);
      assert.equal((await send([{ id: 'review-source-01' }], 'other-book')).status, 404);
      assert.equal((await send([{ id: 'source-not-owned' }])).status, 404);
      assert.equal((await send(Array.from({ length: 21 }, (_, i) => ({ id: 'id-' + i })))).status, 400);
      await writeFile(path.join(directory, 'sources.json'), JSON.stringify({ version: 1, updatedAt: now, sources: sources.map((s, i) => i === 0 ? { ...s, status: 'running', chunks: [] } : s) }));
      const pending = await send([{ id: 'review-source-01' }]); assert.equal(pending.status, 409); assert.match((await pending.json()).error, /解析完成/);
      await writeFile(path.join(directory, 'sources.json'), JSON.stringify({ version: 1, updatedAt: now, sources: sources.map(s => ({ ...s, chunks: s.chunks.map(c => ({ ...c, sourceTitle: '过长来源标题'.repeat(1000) })) })) }));
      assert.equal((await send(sources.map(s => ({ id: s.id })))).status, 422);
      assert.equal(requests.length, beforeRejected, 'Scope, readiness and budget failures must not invoke a model');
    }
    const result = { ok: true, baselineDefect: expectTruncated, actualSdk: 'agentscope==2.0.10', selectedSources: 10, modelSourceIds, citationSourceIds: citations.map((c: { sourceId: string }) => c.sourceId), nativeSkillRead: true, hasReviewMethod, loadedSkillChars: loadedSkill.length, modelRequests: requests.length, paidCalls: 0, forgedClientTextExcluded: true, stream };
    console.log(JSON.stringify(result));
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    await new Promise<void>(resolve => gateway.close(() => resolve()));
    assert.ok(path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('knowtrail-review-qa-'));
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
