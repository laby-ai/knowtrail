import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isResearchDesignInput, readGeneratedDesign, ResearchDesignSaveError } from '../src/lib/research-agent-design';
import { isResearchToolCall } from '../src/lib/research-agent-contract';
import type { ResearchDesignDocument } from '../src/lib/research-design-document';
import type { NotebookDocument } from '../src/lib/private-notebook-document';

async function main() {
  const runId = '00000000-0000-4000-a000-000000000001';
  const fixture = JSON.parse(await readFile('scripts/fixtures/research-design-recovery.json', 'utf8'));
  const input = { kind: 'experiment-design', question: '仅软件验收', experiment: { hypothesis: '可识别缺失记录', experimentalUnit: '模拟记录', arms: ['检查组', '对照组'], primaryOutcome: '识别率', constraints: '', alpha: 0.05, targetPower: 0.8 } };
  assert(isResearchDesignInput(input));
  assert(isResearchDesignInput({ kind: 'hypothesis-generation', question: '保留12、2、10和限定' }));
  for (const invalid of [{ ...input, ownerMemberId: 'forged' }, { ...input, experiment: { ...input.experiment, alpha: 0 } }, { ...input, experiment: undefined }, { ...input, experiment: { ...input.experiment, experimentalUnit: '' } }, { ...input, kind: 'hypothesis-generation' }, { ...input, experiment: { ...input.experiment, apiKey: 'forged' } }]) assert(!isResearchDesignInput(invalid));
  const signal = new AbortController().signal;
  for (const kind of ['hypothesis-generation', 'experiment-design'] as const) {
    const evidence = { runId, citations: [], retrieval: null, status: { answerStatus: 'complete' as const } };
    const data: ResearchDesignDocument = kind === 'hypothesis-generation' ? { question: '模拟核对', result: { ...evidence, hypotheses: fixture.hypothesis.hypotheses } } : { form: { question: input.question, ...input.experiment, armsText: input.experiment.arms.join(',') }, result: { ...evidence, protocol: fixture.experiment, artifactMarkdown: '# 原协议', artifactFileName: 'protocol.md' } };
    const document: NotebookDocument<ResearchDesignDocument> = { revision: 'a'.repeat(64), updatedAt: '2026-10-17T00:00:00Z', data };
    const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\r\n\r\n`;
    const bytes = new TextEncoder().encode(frame({ document }) + 'data: [DONE]\r\n\r\n');
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } }));
    assert.deepEqual(await readGeneratedDesign(response, kind, runId, signal), document);
    await assert.rejects(readGeneratedDesign(new Response(frame({ document })), kind, runId.replace(/1$/, '2'), signal), /尚未确认保存/);
    await assert.rejects(readGeneratedDesign(new Response(frame({ unsavedDocument: data, saveError: '保存失败' })), kind, runId, signal), /保存失败/);
    await readGeneratedDesign(new Response(frame({ unsavedDocument: data, saveError: '保存失败' })), kind, runId, signal).then(() => assert.fail('Unsaved result must not be called durable'), error => {
      assert(error instanceof ResearchDesignSaveError); assert.deepEqual(error.data, data);
    });
    await assert.rejects(readGeneratedDesign(Response.json({ error: '版本冲突' }, { status: 409 }), kind, runId, signal), /版本冲突/);
    const reference = { kind, question: '模拟核对', sourceIds: ['source-1'], revision: document.revision, runId, status: 'complete' };
    const call = { id: 'call-1', plugin: kind, query: '模拟核对', status: 'ready', design: reference };
    assert(isResearchToolCall(call));
    assert(!isResearchToolCall({ ...call, plugin: 'report' }));
    assert(!isResearchToolCall({ ...call, design: { ...reference, revision: 'bad' } }));
    const pending = { ...call, status: 'failed', design: undefined, pendingDesign: { kind, question: 'question' in data ? data.question : data.form.question, sourceIds: reference.sourceIds, runId, data, expectedRevision: null } };
    assert(isResearchToolCall(pending));
    assert(!isResearchToolCall({ ...pending, status: 'ready' }));
    assert(!isResearchToolCall({ ...pending, pendingDesign: { ...pending.pendingDesign, expectedRevision: 'forged' } }));
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(readGeneratedDesign(new Response(frame({ document })), kind, runId, aborted.signal), { name: 'AbortError' });
  }
  console.log('Design tools require explicit complete inputs and exact durable versions; fragmented streams, failed saves, conflicts, cancellation and plugin mismatches remain distinct.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
