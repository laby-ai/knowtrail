import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEEP_RESEARCH_REQUIRED_SECTIONS,
  buildDeepResearchPrompt,
  classifyDeepResearchAnswer,
  hasSubstantiveDeepResearchEvidence,
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
assert.doesNotMatch(prompt, /本报告已完成全网检索|以下来源已核验全文/, 'Prompt must not claim unsupported search or full-text verification.');

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

const routePath = path.join(process.cwd(), 'src/app/api/ai/deep-research/route.ts');
assert.ok(fs.existsSync(routePath), 'Deep research should provide a dedicated server route.');
const routeSource = fs.readFileSync(routePath, 'utf8');
assert.match(routeSource, /buildGroundedRetrievalContext/, 'Route should use the existing grounded retrieval layer.');
assert.match(routeSource, /reserveAIUsage/, 'Route should preserve account billing reservations.');
assert.match(routeSource, /llmStream/, 'Route should forward model output incrementally.');
assert.match(routeSource, /request\.signal/, 'Route should propagate client cancellation.');
assert.match(routeSource, /X-Accel-Buffering[^\n]+no/, 'Route should disable proxy buffering for SSE.');
assert.match(routeSource, /deep_research_no_evidence/, 'Route should reject report success when no evidence is available.');

console.log(JSON.stringify({
  ok: true,
  checked: [
    'deep research prompt is bounded to selected sources and required report sections',
    'no-evidence and incomplete outputs cannot be marked complete',
    'dedicated route keeps grounded retrieval, billing, streaming, cancellation, and SSE headers',
  ],
}, null, 2));
