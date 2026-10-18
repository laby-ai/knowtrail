import assert from 'node:assert/strict';
import { readGeneratedReport } from '../src/lib/research-agent-report';
import { researchReportLengthWarning } from '../src/lib/research-report-document';

async function main() {
  const runId = '00000000-0000-4000-a000-000000000001';
  const document = { revision: 'a'.repeat(64), updatedAt: '2026-10-17T00:00:00Z', data: { questionDraft: '核对模拟记录', report: {
    runId, question: '核对模拟记录', answer: '12条剔除2条保留10条，仅用于软件验收[1]。', citations: [{ paperId: 'source-1', paperShortName: '模拟记录', excerpt: '保留10条' }], retrieval: null, citationAudit: null, researchStatus: null, status: 'complete',
  } } };
  const signal = new AbortController().signal;
  const legacy = { ...document.data.report, question: '总计250字以内', answer: '字'.repeat(251) };
  const before = JSON.stringify(legacy);
  assert.match(researchReportLengthWarning(legacy) || '', /251字，超过要求的250字/);
  assert.equal(JSON.stringify(legacy), before, 'Read-time quality warnings must not rewrite an immutable report or its old completion flag');
  assert.equal(researchReportLengthWarning({ ...legacy, answer: '字'.repeat(250) }), undefined);
  assert.equal(researchReportLengthWarning({ ...legacy, question: '核对模拟记录' }), undefined);
  const frame = (data: unknown) => `data: ${JSON.stringify(data)}\r\n\r\n`;
  const text = frame({ content: '尚未保存的正文' }) + frame({ document }) + 'data: [DONE]\r\n\r\n';
  const bytes = new TextEncoder().encode(text);
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } }));
  assert.deepEqual(await readGeneratedReport(response, runId, signal), document, 'Fragmented UTF-8/SSE still requires the exact durable version');
  await assert.rejects(readGeneratedReport(new Response(frame({ content: '文本不等于保存' })), runId, signal), /尚未确认保存/);
  await assert.rejects(readGeneratedReport(new Response(frame({ document })), '00000000-0000-4000-a000-000000000002', signal), /尚未确认保存/);
  await assert.rejects(readGeneratedReport(Response.json({ error: '另一个页面已保存新内容' }, { status: 409 }), runId, signal), /另一个页面/);
  await assert.rejects(readGeneratedReport(new Response(frame({ unsavedDocument: document.data, error: '保存失败' })), runId, signal), /保存失败/);
  const partial = { ...document, data: { ...document.data, report: { ...document.data.report, status: 'incomplete' } } };
  assert.deepEqual(await readGeneratedReport(new Response(frame({ document: partial, error: '生成中断' })), runId, signal), partial, 'Durably saved partial output stays labelled incomplete');
  const abort = new AbortController(); abort.abort();
  await assert.rejects(readGeneratedReport(new Response(text), runId, abort.signal), { name: 'AbortError' });
  console.log('Report tool accepts exact durable acknowledgements; fragmented text, conflicts, unsaved output and cancellation stay distinct.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
