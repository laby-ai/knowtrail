import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEEP_RESEARCH_REQUIRED_SECTIONS,
  DEEP_RESEARCH_SYSTEM_PROMPT,
  auditDeepResearchLength,
  deepResearchCharacterLimit,
  buildDeepResearchPrompt,
  buildDeepResearchRepairPrompt,
  classifyDeepResearchAnswer,
  hasSubstantiveDeepResearchEvidence,
  removeUncitedDeepResearchClaims,
} from '../src/lib/deep-research-contract';

const prompt = buildDeepResearchPrompt({
  question: '证据合成方法如何降低结论偏差？',
  evidenceContext: '[1] Evidence synthesis methods\nsourceId: paper-1\n摘录: preregistration reduces selective reporting.',
  sourceCount: 2,
});

assert.match(prompt, /证据合成方法如何降低结论偏差/, 'Prompt should preserve the research question.');
const request = JSON.parse(prompt);
assert.equal(request.task.question, '证据合成方法如何降低结论偏差？');
assert.match(DEEP_RESEARCH_SYSTEM_PROMPT, /仅使用当前已选证据/, 'System policy should state the selected-source boundary.');
for (const section of DEEP_RESEARCH_REQUIRED_SECTIONS) {
  assert.match(DEEP_RESEARCH_SYSTEM_PROMPT, new RegExp(section), `System policy should require section: ${section}`);
}
assert.match(prompt, /\[1\]/, 'Prompt should preserve numbered evidence markers.');
assert.match(DEEP_RESEARCH_SYSTEM_PROMPT, /每个二级标题下只写带证据编号的独立陈述/, 'Prompt should constrain every section body to cited claims.');
assert.match(DEEP_RESEARCH_SYSTEM_PROMPT, /任何不含引用编号的陈述都会使报告判定为未完成/, 'Prompt should explain the fail-closed citation audit.');
assert.doesNotMatch(request.evidenceContext, /写作规则|每个事实判断/);
assert.doesNotMatch(prompt, /本报告已完成全网检索|以下来源已核验全文/, 'Prompt must not claim unsupported search or full-text verification.');

const repairPrompt = buildDeepResearchRepairPrompt({
  question: '证据合成方法如何降低结论偏差？',
  evidenceContext: '[1] Evidence synthesis methods\n摘录: preregistration reduces selective reporting.',
  sourceCount: 1,
});
assert.match(repairPrompt, /未通过章节、引用或篇幅检查/);
assert.match(repairPrompt, /每章优先一条有据短句/);
assert.doesNotMatch(repairPrompt, /仅写一个可由证据支持的单句陈述\[1\]/, 'Repair must not offer a copyable fake-evidence skeleton.');
assert.equal(deepResearchCharacterLimit('九节合计250字以内'), 250);
assert.equal(deepResearchCharacterLimit('最多300字，结论50字以内'), 300, 'A section limit must not replace the whole-report budget.');
assert.equal(deepResearchCharacterLimit('结论50字以内'), null);
assert.equal(deepResearchCharacterLimit('核对12条记录，保留10条'), null);
assert.equal(auditDeepResearchLength('## 问题\n- 数据[1]。', '不超过10字').status, 'pass');
assert.equal(auditDeepResearchLength('## 问题\n- 数据[1]。'.repeat(10), '不超过10字').status, 'too-long');
assert.equal(classifyDeepResearchAnswer({ citationCount: 1, citationAuditStatus: 'pass', sectionCoverageStatus: 'pass', outputConstraintStatus: 'too-long' }), 'incomplete');

assert.equal(classifyDeepResearchAnswer({
  citationCount: 0,
  citationAuditStatus: 'none',
  sectionCoverageStatus: 'missing-required-sections',
}), 'no-evidence');
assert.equal(classifyDeepResearchAnswer({
  citationCount: 2,
  citationAuditStatus: 'missing-markers',
  sectionCoverageStatus: 'pass',
}), 'incomplete');
assert.equal(classifyDeepResearchAnswer({
  citationCount: 2,
  citationAuditStatus: 'pass',
  sectionCoverageStatus: 'missing-claim-citations',
}), 'incomplete');
assert.equal(classifyDeepResearchAnswer({
  citationCount: 2,
  citationAuditStatus: 'pass',
  sectionCoverageStatus: 'pass',
}), 'complete');
assert.equal(hasSubstantiveDeepResearchEvidence([
  { excerpt: 'Only a paper title' },
]), false, 'Title-only metadata must not qualify as deep-research evidence.');
assert.equal(hasSubstantiveDeepResearchEvidence([
  { excerpt: 'This abstract records the method, sample boundary, result, and limitation for source verification.' },
]), true, 'A substantive abstract or source excerpt should qualify as evidence.');

const sanitized = removeUncitedDeepResearchClaims(
  '## 主要结论\n透明记录提升复核性[1]。这不代表因果关系。\n\n## 争议或不足\n- 当前证据没有量化比较[1]。\n- 需要额外核验。',
  {
    status: 'missing-claim-citations',
    requiredSections: ['主要结论', '争议或不足'],
    missingSections: [],
    emptySections: [],
    uncitedClaims: [
      { section: '主要结论', line: 2, text: '这不代表因果关系。' },
      { section: '争议或不足', line: 6, text: '需要额外核验。' },
    ],
  },
);
assert.equal(sanitized.removedCount, 2, 'Sanitizer should report every removed uncited claim.');
assert.match(sanitized.answer, /透明记录提升复核性\[1\]/);
assert.match(sanitized.answer, /当前证据没有量化比较\[1\]/);
assert.doesNotMatch(sanitized.answer, /这不代表因果关系|需要额外核验/, 'Sanitizer must remove rather than cite unsupported claims.');

const routePath = path.join(process.cwd(), 'src/app/api/ai/deep-research/route.ts');
const panelPath = path.join(process.cwd(), 'src/components/studio/DeepResearchPanel.tsx');
assert.ok(fs.existsSync(routePath), 'Deep research should provide a dedicated server route.');
const routeSource = fs.readFileSync(routePath, 'utf8');
const panelSource = fs.readFileSync(panelPath, 'utf8');
assert.match(routeSource, /buildGroundedRetrievalContext/, 'Route should use the existing grounded retrieval layer.');
assert.match(routeSource, /reserveAIUsage/, 'Route should preserve account billing reservations.');
assert.match(routeSource, /llmStream/, 'Route should forward model output incrementally.');
assert.match(routeSource, /request\.signal/, 'Route should propagate client cancellation.');
assert.match(routeSource, /createGroundedSseResponse/, 'Route should delegate SSE headers and cancellation to the grounded lifecycle owner.');
assert.match(routeSource, /deep_research_no_evidence/, 'Route should reject report success when no evidence is available.');
assert.match(routeSource, /removeUncitedDeepResearchClaims/, 'Route should conservatively remove uncited claims before final classification.');
assert.match(routeSource, /replaceContent/, 'Route should replace streamed draft text with its final audited form.');
assert.match(routeSource, /buildDeepResearchRepairPrompt/, 'Route should attempt one evidence-bounded repair after a failed coverage audit.');
assert.match(routeSource, /stage: 'repairing'/, 'Route should expose the bounded repair stage to the user.');
assert.match(panelSource, /payload\.replaceContent/, 'Panel should replace the streamed draft with its audited final form.');
assert.match(panelSource, /已移除.*无引用陈述/, 'Panel should explain conservative uncited-claim removal.');

console.log(JSON.stringify({
  ok: true,
  checked: [
    'deep research prompt is bounded to selected sources and required report sections',
    'no-evidence and incomplete outputs cannot be marked complete',
    'dedicated route keeps grounded retrieval, billing, streaming, cancellation, and SSE headers',
  ],
}, null, 2));
