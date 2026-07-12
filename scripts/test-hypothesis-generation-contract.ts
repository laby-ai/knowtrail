import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildHypothesisGenerationPrompt,
  classifyHypothesisGeneration,
  hasSubstantiveHypothesisEvidence,
  parseHypothesisGenerationOutput,
} from '../src/lib/hypothesis-generation-contract';

const prompt = buildHypothesisGenerationPrompt({
  question: '预注册为什么可能降低证据合成中的选择性报告？',
  evidenceContext: '[1] Preregistration study\nsourceId: paper-1\n摘录: preregistration reduces selective reporting.',
  sourceCount: 2,
});

assert.match(prompt, /预注册为什么可能降低证据合成中的选择性报告/, 'Prompt should preserve the research question.');
assert.match(prompt, /只能基于当前已选来源/, 'Prompt should state the selected-source boundary.');
for (const field of ['statement', 'reasoningBasis', 'competingExplanation', 'falsifiablePrediction', 'validationPlan', 'evidenceMarkers', 'uncertainty']) {
  assert.match(prompt, new RegExp(field), `Prompt should require structured field: ${field}`);
}
assert.match(prompt, /不得声称.*新颖性|不得宣称.*新颖/, 'Prompt should prohibit unsupported novelty claims.');
assert.match(prompt, /不得声称.*因果|不得宣称.*因果/, 'Prompt should prohibit unsupported causality claims.');
assert.doesNotMatch(prompt, /实验已完成|统计显著性已经证实/, 'Prompt must not claim completed experiments or significance.');

const parsed = parseHypothesisGenerationOutput(JSON.stringify({
  hypotheses: [
    {
      id: 'H1',
      title: '预注册约束选择性报告',
      statement: '在相同证据条件下，预注册会降低选择性报告。',
      reasoningBasis: '来源描述了预注册与选择性报告之间的关联[1]。',
      competingExplanation: '研究团队培训差异也可能解释该关联[1]。',
      falsifiablePrediction: '若预注册无效，两组选择性报告率不会稳定分离。',
      validationPlan: '比较预注册与未预注册项目，并预先定义主要结局。',
      evidenceMarkers: [1],
      uncertainty: '现有证据未确认因果关系。',
    },
    {
      id: 'H2',
      title: '审查透明度是中介机制',
      statement: '更高的审查透明度可能中介预注册的影响。',
      reasoningBasis: '来源同时讨论了透明度与报告偏差[1]。',
      competingExplanation: '期刊政策差异可能造成相同现象。',
      falsifiablePrediction: '控制透明度后，预注册关联应明显减弱。',
      validationPlan: '收集审查透明度指标并进行分层比较。',
      evidenceMarkers: [1],
      uncertainty: '中介路径需要额外数据验证。',
    },
    {
      id: 'H3',
      title: '效果依赖研究阶段',
      statement: '预注册的效果可能在确认性研究中更明显。',
      reasoningBasis: '来源区分了探索性与确认性研究[1]。',
      competingExplanation: '样本规模差异可能导致表面异质性。',
      falsifiablePrediction: '若研究阶段无影响，两类研究的效果差异应接近零。',
      validationPlan: '按研究阶段预先分层并比较效果。',
      evidenceMarkers: [1],
      uncertainty: '分层样本量可能不足。',
    },
  ],
}));

assert.equal(parsed.hypotheses.length, 3, 'A valid output should retain 3-5 hypotheses.');
assert.deepEqual(parsed.hypotheses.map(item => item.id), ['H1', 'H2', 'H3'], 'Hypothesis IDs should be stable and ordered.');
assert.equal(classifyHypothesisGeneration({ hypothesisCount: 3, validEvidenceMarkerCount: 3 }), 'complete');
assert.equal(classifyHypothesisGeneration({ hypothesisCount: 2, validEvidenceMarkerCount: 2 }), 'incomplete');
assert.equal(classifyHypothesisGeneration({ hypothesisCount: 3, validEvidenceMarkerCount: 0 }), 'no-evidence');
assert.equal(hasSubstantiveHypothesisEvidence([{ excerpt: 'Only a paper title' }]), false);
assert.equal(hasSubstantiveHypothesisEvidence([{ excerpt: 'This abstract describes a method, observed association, boundary, and limitation for hypothesis grounding.' }]), true);

assert.throws(
  () => parseHypothesisGenerationOutput('{"hypotheses":[{"id":"H1","title":"x","statement":"x"}]}'),
  /结构不完整|invalid/i,
  'Incomplete model output must not be accepted as hypothesis cards.',
);

const routePath = path.join(process.cwd(), 'src/app/api/ai/hypothesis-generation/route.ts');
assert.ok(fs.existsSync(routePath), 'Hypothesis generation should provide a dedicated server route.');
const routeSource = fs.readFileSync(routePath, 'utf8');
assert.match(routeSource, /buildGroundedRetrievalContext/, 'Route should use grounded retrieval.');
assert.match(routeSource, /reserveAIUsage/, 'Route should preserve account billing.');
assert.match(routeSource, /llmStream/, 'Route should use the real streaming model client.');
assert.match(routeSource, /request\.signal/, 'Route should propagate cancellation.');
assert.match(routeSource, /hypothesis_generation_no_evidence/, 'Route should reject generation without substantive evidence.');
assert.match(routeSource, /createGroundedSseResponse/, 'Route should delegate SSE headers and cancellation to the grounded lifecycle owner.');

console.log(JSON.stringify({
  ok: true,
  checked: [
    'selected-source prompt requires evidence-backed and falsifiable hypothesis fields',
    'only complete 3-5 card outputs with evidence can be marked complete',
    'dedicated route preserves grounded retrieval, billing, model execution, and cancellation',
  ],
}, null, 2));
