import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEEP_RESEARCH_REQUIRED_SECTIONS,
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
assert.match(prompt, /只能基于已选来源/, 'Prompt should state the selected-source boundary.');
for (const section of DEEP_RESEARCH_REQUIRED_SECTIONS) {
  assert.match(prompt, new RegExp(section), `Prompt should require section: ${section}`);
}
assert.match(prompt, /\[1\]/, 'Prompt should preserve numbered evidence markers.');
assert.match(prompt, /每个二级标题下只写带证据编号的独立陈述/, 'Prompt should constrain every section body to cited claims.');
assert.match(prompt, /任何不含引用编号的陈述都会使报告判定为未完成/, 'Prompt should explain the fail-closed citation audit.');
assert.doesNotMatch(prompt, /本报告已完成全网检索|以下来源已核验全文/, 'Prompt must not claim unsupported search or full-text verification.');

const repairPrompt = buildDeepResearchRepairPrompt({
  question: '证据合成方法如何降低结论偏差？',
  evidenceContext: '[1] Evidence synthesis methods\n摘录: preregistration reduces selective reporting.',
  sourceCount: 1,
});
assert.match(repairPrompt, /上一版报告未通过引用覆盖审计/);
assert.match(repairPrompt, /每个章节只写 1 至 2 条/);
assert.match(repairPrompt, /每条只能有一个句号/);
for (const section of DEEP_RESEARCH_REQUIRED_SECTIONS) {
  assert.match(repairPrompt, new RegExp(`## ${section}`));
}

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
