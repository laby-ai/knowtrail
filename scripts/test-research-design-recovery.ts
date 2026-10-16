import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { emptyHypothesis, emptyExperiment, isHypothesisDocument, isExperimentDocument } from '../src/lib/research-design-document';
import { prepareResearchDesign, finishResearchDesign } from '../src/lib/research-design-storage';
import { readNotebookDocument, saveNotebookDocument } from '../src/lib/private-notebook-document';

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-design-'));
  const before = process.env.STUDIO_DOCUMENT_STORE_DIR; process.env.STUDIO_DOCUMENT_STORE_DIR = root;
  const scope = { ownerMemberId: 'fixture-a', notebookId: 'research-design-fixture' };
  const runId = '00000000-0000-4000-a000-000000000001';
  try {
    const fixture = JSON.parse(await readFile('scripts/fixtures/research-design-recovery.json', 'utf8'));
    const citations = [{ paperId: 'fixture-source', paperShortName: '软件验收', excerpt: '12条剔除2条后保留10条' }];
    const evidence = { runId, citations, retrieval: null, status: { answerStatus: 'complete' as const } };
    const hypothesis = { ...emptyHypothesis(), question: '模拟记录核验？', result: { ...evidence, hypotheses: fixture.hypothesis.hypotheses } };
    const experiment = { ...emptyExperiment(), result: { ...evidence, protocol: fixture.experiment, artifactMarkdown: '# 软件验收协议', artifactFileName: 'experiment-preregistration.md' } };
    assert(isHypothesisDocument(hypothesis)); assert(isExperimentDocument(experiment));
    assert(!isHypothesisDocument({ ...hypothesis, result: { ...hypothesis.result, hypotheses: [{}] } }));
    assert(!isExperimentDocument({ ...experiment, result: { ...experiment.result, protocol: {} } }));
    for (const [kind, data] of [['hypothesis-generation', hypothesis], ['experiment-design', experiment]] as const) {
      const input = { persistArtifact: true, expectedRevision: null, runId };
      const prepared = await prepareResearchDesign(input, kind, scope);
      await assert.rejects(prepareResearchDesign(input, kind, scope), /正在生成/);
      const saved = await finishResearchDesign(input, kind, prepared, data, new AbortController().signal);
      prepared?.release(); assert(saved.document);
      assert.deepEqual((await readNotebookDocument(scope, kind))?.data, data);
      assert.equal(await readNotebookDocument({ ...scope, ownerMemberId: 'fixture-b' }, kind), null);
      assert.equal((await prepareResearchDesign(input, kind, scope))?.replay, true);
      await assert.rejects(prepareResearchDesign({ ...input, runId: runId.replace(/1$/, '2') }, kind, scope), /另一个页面/);
      const next = { ...input, expectedRevision: saved.document.revision, runId: runId.replace(/1$/, '3') };
      const task = await prepareResearchDesign(next, kind, scope); const interrupted = new AbortController(); interrupted.abort();
      await assert.rejects(finishResearchDesign(next, kind, task, data, interrupted.signal)); task?.release();
      assert.deepEqual((await readNotebookDocument(scope, kind))?.data, data);
      await writeFile(path.join(root, 'blocked'), 'own fixture'); process.env.STUDIO_DOCUMENT_STORE_DIR = path.join(root, 'blocked', 'store');
      const failure = await finishResearchDesign(next, kind, task, data, new AbortController().signal);
      assert(failure.unsavedDocument && failure.saveError); process.env.STUDIO_DOCUMENT_STORE_DIR = root;
      await assert.rejects(saveNotebookDocument(scope, kind, { ...data, result: null }, null), /另一个页面/);
    }
    console.log(JSON.stringify({ ok: true, durableResults: true, invalidOutputRejected: true, ownerIsolation: true, conflicts: true, replayWithoutGeneration: true, cancellationKeepsPrior: true, failedSaveReturnsRecoverableResult: true, paidCalls: 0 }));
  } finally { if (before === undefined) delete process.env.STUDIO_DOCUMENT_STORE_DIR; else process.env.STUDIO_DOCUMENT_STORE_DIR = before; await rm(root, { recursive: true, force: true }); }
}
void main();
