import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  consumeHypothesisGenerationSse,
  createHypothesisGenerationProbeBody,
  validateHypothesisGenerationResult,
} from './lib/live-hypothesis-generation-smoke.mjs';

function streamFrom(events) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event));
      controller.close();
    },
  });
}

const probe = createHypothesisGenerationProbeBody();
assert.equal(probe.papers.length, 1);
assert.ok(probe.papers[0].content.length >= 120, 'Probe evidence must be substantive.');
assert.match(probe.question, /选择性报告|复核/);

const hypotheses = ['H1', 'H2', 'H3'].map((id, index) => ({
  id,
  title: `可证伪假设 ${index + 1}`,
  statement: `记录环节 ${index + 1} 可能降低选择性报告。`,
  reasoningBasis: '给定来源说明显式记录可减少选择偏差[1]。',
  competingExplanation: '团队训练差异也可能解释观察到的差异。',
  falsifiablePrediction: '若该机制不成立，记录组与对照组的偏差指标不会稳定分离。',
  validationPlan: '预先定义分组、主要指标和反例判定规则后进行比较。',
  evidenceMarkers: [1],
  uncertainty: '当前来源只提供方法依据，尚无直接实验结果。',
}));

const result = await consumeHypothesisGenerationSse(streamFrom([
  'data: {"progress":{"stage":"evidence-ready"},"citations":[{"sourceId":"live-hypothesis-source","excerpt":"substantive evidence"}],"retrieval":{"sourceCount":1}}\n\n',
  'data: {"progress":{"stage":"generating"}}\n\n',
  'data: {"progress":{"stage":"auditing"}}\n\n',
  `data: ${JSON.stringify({ hypotheses, hypothesisStatus: { answerStatus: 'complete', invalidEvidenceMarkers: [] }, billing: { status: 'settled' } })}\n\n`,
  'data: [DONE]\n\n',
]));

const summary = validateHypothesisGenerationResult(result);
assert.equal(summary.hypothesisCount, 3);
assert.equal(summary.citationCount, 1);
assert.equal(summary.answerStatus, 'complete');
assert.deepEqual(summary.progressStages, ['evidence-ready', 'generating', 'auditing']);

assert.throws(
  () => validateHypothesisGenerationResult({ ...result, hypothesisStatus: { answerStatus: 'incomplete' } }),
  /not complete/,
);
assert.throws(
  () => validateHypothesisGenerationResult({ ...result, hypotheses: [{ ...hypotheses[0], evidenceMarkers: [] }] }),
  /3-5|evidence/i,
);

await assert.rejects(
  () => consumeHypothesisGenerationSse(streamFrom(['data: {"error":"provider failed","errorType":"hypothesis_generation_failed"}\n\n'])),
  /provider failed/,
);

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.equal(packageJson.scripts?.['smoke:live-hypothesis-generation'], 'node ./scripts/smoke-live-hypothesis-generation.mjs');
assert.equal(packageJson.scripts?.['test:live-hypothesis-generation-smoke'], 'node ./scripts/test-live-hypothesis-generation-smoke.mjs');
assert.match(packageJson.scripts?.validate || '', /test:live-hypothesis-generation-smoke/);

console.log(JSON.stringify({
  ok: true,
  checked: [
    'probe uses deterministic substantive evidence',
    'SSE parser preserves progress, citations, hypotheses, status, billing, and done',
    'incomplete, uncited, and provider-failed output fails closed',
    'runner and validation entrypoints remain wired',
  ],
}, null, 2));
