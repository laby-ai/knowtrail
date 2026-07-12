import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  auditPeerReviewReport,
  buildPeerReviewMarkdown,
  buildPeerReviewPrompt,
  parsePeerReviewOutput,
} from '../src/lib/peer-review-contract';

const manuscript = `## Methods
We trained Model-X on dataset A using a random 80/20 split. The manuscript does not state whether repeated records from the same participant were kept in one split.

## Results
Model-X achieved 87.4% accuracy (p=0.03). We conclude that Model-X causes better clinical outcomes.`;

const prompt = buildPeerReviewPrompt({
  manuscript,
  scope: '全文逻辑与方法严谨性',
  perspective: 'methodology',
  sourceCount: 1,
  evidenceContext: '[1] Leakage guidance\n摘录: participant-level splitting is needed when records are repeated.',
});
for (const field of ['summary', 'strengths', 'majorComments', 'minorComments', 'location', 'excerpt', 'problem', 'importance', 'action', 'evidenceStatus', 'evidenceMarkers', 'questions', 'limitations']) {
  assert.match(prompt, new RegExp(field), `Prompt should require ${field}.`);
}
assert.match(prompt, /只读|不得直接改稿/, 'Peer review must remain read-only.');
assert.match(prompt, /确切片段|原文中逐字定位/, 'Every comment must locate an exact manuscript excerpt.');
assert.match(prompt, /待核验/, 'Unverified concerns must be labeled instead of fabricated.');
assert.match(prompt, /单一审查视角|不得模拟多个审稿人/, 'The product must not fake reviewer diversity.');
assert.match(prompt, /不给.*推荐，不打分/, 'The product must explicitly prohibit fabricated editorial recommendations and scores.');

const report = parsePeerReviewOutput(JSON.stringify({
  title: '方法严谨性审查报告',
  summary: {
    manuscriptFocus: '稿件评估 Model-X 在数据集 A 上的分类表现。',
    overallAssessment: '当前文本给出了划分比例和结果指标，但个体级数据隔离与因果结论仍需补充说明。',
  },
  strengths: ['报告了训练/测试划分比例和准确率。'],
  majorComments: [{
    location: 'Methods，第 1 段',
    excerpt: 'using a random 80/20 split',
    problem: '当前描述无法判断同一参与者的重复记录是否跨越训练集和测试集。',
    importance: '若重复记录跨集合，评估结果可能受到信息泄漏影响。',
    action: '说明划分单位；如存在重复记录，按参与者重新划分并报告复核结果。',
    evidenceStatus: 'source-supported',
    evidenceMarkers: [1],
  }],
  minorComments: [{
    location: 'Results，第 1 段',
    excerpt: 'p=0.03',
    problem: '未说明该 p 值对应的检验、效应量和置信区间。',
    importance: '读者无法判断统计证据的实际大小和适用前提。',
    action: '补充检验名称、效应量、置信区间和假设检查。',
    evidenceStatus: 'needs-verification',
    evidenceMarkers: [],
  }],
  questions: ['数据是否包含同一参与者的重复记录？'],
  limitations: ['只审查了用户提供的文本；未核验原始数据、代码、图表或参考文献。'],
}));

const audit = auditPeerReviewReport(manuscript, report, 1);
assert.equal(audit.safe, true);
assert.deepEqual(audit.unlocatedComments, []);
assert.deepEqual(audit.invalidEvidenceMarkers, []);
assert.deepEqual(audit.unsupportedEvidenceClaims, []);
assert.deepEqual(audit.editorialScores, []);

const fabricatedLocation = parsePeerReviewOutput(JSON.stringify({
  ...report,
  majorComments: [{
    ...report.majorComments[0],
    excerpt: 'the preregistered primary endpoint',
  }],
}));
assert.equal(auditPeerReviewReport(manuscript, fabricatedLocation, 1).safe, false, 'Comments that cannot be located in the manuscript must be rejected.');

const unsupportedEvidence = parsePeerReviewOutput(JSON.stringify({
  ...report,
  majorComments: [{
    ...report.majorComments[0],
    evidenceStatus: 'source-supported',
    evidenceMarkers: [],
  }],
}));
assert.equal(auditPeerReviewReport(manuscript, unsupportedEvidence, 1).safe, false, 'Source-supported comments require a valid source marker.');

const scoredReport = parsePeerReviewOutput(JSON.stringify({
  ...report,
  summary: { ...report.summary, overallAssessment: 'Recommendation: Major Revision; score 6/10.' },
}));
assert.equal(auditPeerReviewReport(manuscript, scoredReport, 1).safe, false, 'Editorial recommendations and scores must not pass as evidence-backed review findings.');

const markdown = buildPeerReviewMarkdown(report, audit);
for (const heading of ['总评', '主要优点', 'Major Comments', 'Minor Comments', '给作者的问题', '审查边界']) {
  assert.match(markdown, new RegExp(heading), `Artifact should include ${heading}.`);
}
assert.match(markdown, /待核验/, 'Artifact should preserve evidence verification status.');
assert.doesNotMatch(markdown, /已完成修改|引用已核验|Accept|Reject|\d+\/10/, 'Artifact must not fabricate revision, verification, or an editorial decision.');

const routePath = path.join(process.cwd(), 'src/app/api/ai/peer-review/route.ts');
assert.ok(fs.existsSync(routePath), 'Peer review should provide a dedicated server route.');
const routeSource = fs.readFileSync(routePath, 'utf8');
assert.match(routeSource, /reserveAIUsage/, 'Route should preserve account billing.');
assert.match(routeSource, /llmStream/, 'Route should use the real streaming model client.');
assert.match(routeSource, /request\.signal/, 'Route should propagate cancellation.');
assert.match(routeSource, /auditPeerReviewReport/, 'Route should reject unlocatable or unsupported comments.');
assert.match(routeSource, /peer_review_unsafe_output/, 'Unsafe output should have a stable error type.');
assert.match(routeSource, /createGroundedSseResponse/, 'Route should delegate SSE headers and cancellation to the grounded lifecycle owner.');

console.log(JSON.stringify({ ok: true, checked: [
  'read-only report schema requires exact manuscript locations and actionable comments',
  'source-supported comments require valid evidence markers while unknowns stay needs-verification',
  'deterministic audit rejects invented locations, unsupported evidence, and editorial scores',
  'download preserves review scope and no-edit/no-verification boundaries',
] }, null, 2));
