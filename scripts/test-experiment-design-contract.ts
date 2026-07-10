import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildExperimentDesignPrompt,
  buildPreregistrationMarkdown,
  classifyExperimentDesign,
  hasSubstantiveExperimentEvidence,
  parseExperimentDesignOutput,
} from '../src/lib/experiment-design-contract';

const prompt = buildExperimentDesignPrompt({
  question: '预注册是否降低选择性报告？',
  hypothesis: '预注册组的选择性报告率低于未预注册组。',
  experimentalUnit: '独立研究项目',
  arms: ['预注册', '未预注册对照'],
  primaryOutcome: '预先定义主要结局与最终报告的一致率',
  constraints: '研究项目来自不同机构，需要控制机构差异。',
  alpha: 0.05,
  targetPower: 0.8,
  sourceCount: 2,
  evidenceContext: '[1] Preregistration evidence\nsourceId: paper-1\n摘录: preregistration is associated with reporting transparency.',
});

assert.match(prompt, /独立研究项目/, 'Prompt should preserve the independent experimental unit.');
assert.match(prompt, /预注册[\s\S]*未预注册对照/, 'Prompt should preserve treatment and control arms.');
for (const field of [
  'designType',
  'replicationLevel',
  'arms',
  'primaryOutcome',
  'randomization',
  'blockingAndBlinding',
  'confounders',
  'sampleSizePlan',
  'analysisPlan',
  'stoppingRules',
  'ethicsAndFeasibility',
  'evidenceMarkers',
  'limitations',
]) {
  assert.match(prompt, new RegExp(field), `Prompt should require protocol field: ${field}`);
}
assert.match(prompt, /不得.*样本量.*数字|不得.*所需 N/, 'Prompt must prohibit model-guessed sample-size numbers.');
assert.match(prompt, /采集前|预注册/, 'Prompt should keep the feature in the pre-collection design boundary.');
assert.match(prompt, /不得声称伦理审批已通过、实验已完成、统计显著/, 'Prompt must explicitly prohibit completed approval, experiment, or significance claims.');

const protocol = parseExperimentDesignOutput(JSON.stringify({
  title: '预注册与选择性报告的多机构随机区组研究',
  studyMode: 'confirmatory',
  designType: '按机构分层的随机区组设计',
  designRationale: '机构差异可能影响报告实践，因此在机构内随机化[1]。',
  researchQuestion: '预注册是否降低选择性报告？',
  hypothesis: '预注册组的选择性报告率低于未预注册组。',
  experimentalUnit: '独立研究项目',
  replicationLevel: '项目层级；同一项目内多个结局不是独立重复。',
  arms: [
    { name: '预注册', role: 'treatment', intervention: '采集前冻结主要结局与分析计划。' },
    { name: '未预注册对照', role: 'control', intervention: '沿用现有流程，不额外施加预注册要求。' },
  ],
  primaryOutcome: {
    name: '主要结局一致率',
    timing: '项目最终报告提交后评估',
    measurement: '比较采集前计划与最终报告中的主要结局。',
  },
  secondaryOutcomes: ['未报告结局数量', '分析方案偏离数量'],
  randomization: {
    method: '机构内置换区组随机化',
    unit: '独立研究项目',
    seedPlan: '实施前生成并归档整数 seed；分配表由非评估人员保管。',
    allocationConcealment: '评估人员在项目结束前不可见分配序列。',
  },
  blockingAndBlinding: ['按机构区组', '结局编码人员对研究组别盲法'],
  confounders: [
    { factor: '机构政策', control: '在机构内随机化并在分析中纳入机构区组。' },
  ],
  sampleSizePlan: {
    effectBasis: '需从既有研究或预实验确定最小实际意义效应，当前证据不足以给出数值。',
    testFamily: '按主要结局分布选择两组比例或广义线性模型。',
    assumptions: 'alpha=0.05，目标 power=0.80；聚类或失访需另行膨胀。',
    nextAction: '在确定效应依据和组内相关后运行采集前功效计算并归档输入与输出。',
  },
  dataCollectionPlan: ['冻结主要结局定义', '记录机构与项目层级标识', '保留排除原因'],
  analysisPlan: ['以项目为独立单位', '主要分析匹配区组设计', '报告效应量和置信区间'],
  stoppingRules: ['固定 N；除预先定义的安全原因外不根据中期结果提前停止。'],
  exclusionRules: ['仅按采集前定义的资格标准排除项目。'],
  ethicsAndFeasibility: '需由执行机构判断是否涉及伦理审查；本协议不代表审批已获得。',
  evidenceMarkers: [1],
  limitations: ['当前来源片段未提供可直接采用的效应量。'],
}));

assert.equal(protocol.studyMode, 'confirmatory');
assert.equal(protocol.arms.length, 2, 'Protocol should retain treatment and control arms.');
assert.equal(protocol.experimentalUnit, '独立研究项目');
assert.deepEqual(protocol.evidenceMarkers, [1]);
assert.equal('requiredN' in protocol.sampleSizePlan, false, 'Model output must not contain an invented required N field.');
assert.equal(classifyExperimentDesign({ protocol, citationCount: 1 }), 'complete');
assert.equal(classifyExperimentDesign({ protocol, citationCount: 0 }), 'no-evidence');
assert.equal(hasSubstantiveExperimentEvidence([{ excerpt: 'Only a title' }]), false);
assert.equal(hasSubstantiveExperimentEvidence([{ excerpt: 'This source describes randomization, independent units, reporting outcomes, and study limitations.' }]), true);

assert.throws(
  () => parseExperimentDesignOutput(JSON.stringify({
    ...protocol,
    sampleSizePlan: {
      ...protocol.sampleSizePlan,
      nextAction: '根据通用经验，所需 N=64，可以直接开始招募。',
    },
  })),
  /样本量.*确定性计算|不得.*N/i,
  'Model-guessed numeric sample size claims must be rejected even when hidden in text.',
);

const markdown = buildPreregistrationMarkdown(protocol, { alpha: 0.05, targetPower: 0.8 });
for (const heading of ['背景与假设', '设计与独立重复', '随机化、区组与盲法', '样本量与功效', '分析计划', '停止、排除与伦理', '证据与边界']) {
  assert.match(markdown, new RegExp(heading), `Preregistration artifact should include ${heading}.`);
}
assert.match(markdown, /未执行样本量计算/, 'Artifact must state that sample size was not calculated.');
assert.doesNotMatch(markdown, /所需样本量为\s*\d+|实验已经完成|伦理审批已通过/, 'Artifact must not fabricate execution or approval claims.');

assert.throws(
  () => parseExperimentDesignOutput('{"title":"incomplete"}'),
  /结构不完整|invalid/i,
  'Incomplete model output must not be accepted as an experiment protocol.',
);

const routePath = path.join(process.cwd(), 'src/app/api/ai/experiment-design/route.ts');
assert.ok(fs.existsSync(routePath), 'Experiment design should provide a dedicated server route.');
const routeSource = fs.readFileSync(routePath, 'utf8');
assert.match(routeSource, /buildGroundedRetrievalContext/, 'Route should use grounded retrieval.');
assert.match(routeSource, /reserveAIUsage/, 'Route should preserve account billing.');
assert.match(routeSource, /llmStream/, 'Route should use the real streaming model client.');
assert.match(routeSource, /request\.signal/, 'Route should propagate cancellation.');
assert.match(routeSource, /experiment_design_no_evidence/, 'Route should reject design generation without substantive evidence.');
assert.match(routeSource, /X-Accel-Buffering[^\n]+no/, 'Route should disable proxy buffering for progress events.');

console.log(JSON.stringify({
  ok: true,
  checked: [
    'selected-source prompt requires independent units, controls, randomization, outcomes, bias controls, and preregistration fields',
    'strict protocol parsing rejects incomplete output and never accepts model-guessed sample size N',
    'download artifact preserves pre-collection, evidence, ethics, and no-execution boundaries',
    'dedicated route preserves grounded retrieval, billing, streaming, and cancellation',
  ],
}, null, 2));
