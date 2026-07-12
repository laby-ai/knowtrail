import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildAcademicWritingMarkdown,
  buildAcademicWritingPrompt,
  classifyAcademicWritingDraft,
  hasSubstantiveWritingEvidence,
  parseAcademicWritingOutput,
} from '../src/lib/academic-writing-contract';

const prompt = buildAcademicWritingPrompt({
  writingGoal: '起草一节说明预注册如何减少选择性报告的引言。',
  targetSection: 'introduction',
  audience: '研究方法学期刊读者',
  requirements: '三到四段，先界定问题，再说明研究缺口。',
  sourceCount: 2,
  evidenceContext: '[1] Preregistration evidence\n摘录: preregistration improves reporting transparency.',
});

for (const field of ['outline', 'paragraphs', 'role', 'evidenceMarkers', 'claimEvidenceMap', 'supportStatus', 'limitations', 'revisionChecklist']) {
  assert.match(prompt, new RegExp(field), `Prompt should require ${field}.`);
}
assert.match(prompt, /一段一义|段落角色/, 'Prompt should require paragraph-level structure.');
assert.match(prompt, /不得编造.*数据|不得.*统计结论/, 'Prompt should prohibit fabricated data and findings.');
assert.match(prompt, /不负责.*引用真实性|候选引用/, 'Prompt should preserve the citation-verification boundary.');

const draft = parseAcademicWritingOutput(JSON.stringify({
  title: '预注册与选择性报告',
  targetSection: 'introduction',
  outline: [
    { heading: '问题背景', purpose: '界定选择性报告及其影响。' },
    { heading: '已有证据', purpose: '概括预注册与透明度的关系。' },
    { heading: '研究缺口', purpose: '指出仍需核验的边界。' },
  ],
  paragraphs: [
    { role: 'opening', text: '选择性报告会削弱研究结论的可解释性[1]。', evidenceMarkers: [1], supportStatus: 'supported' },
    { role: 'evidence', text: '现有来源提示预注册与报告透明度改善相关[1]。', evidenceMarkers: [1], supportStatus: 'supported' },
    { role: 'limitation', text: '当前来源片段不能证明预注册必然带来因果改善。', evidenceMarkers: [], supportStatus: 'needs-evidence' },
  ],
  claimEvidenceMap: [
    { claim: '预注册与透明度改善相关。', evidence: '来源片段报告二者存在关联。', evidenceMarkers: [1], status: 'supported' },
    { claim: '预注册产生因果改善。', evidence: '当前来源不足。', evidenceMarkers: [], status: 'needs-evidence' },
  ],
  limitations: ['仅基于当前已选来源片段，候选引用仍需回到原文核验。'],
  revisionChecklist: ['核验来源原文和研究设计。', '补充目标期刊格式后再投稿。'],
}));

assert.equal(draft.paragraphs.length, 3);
assert.equal(classifyAcademicWritingDraft({ draft, citationCount: 1 }), 'complete');
assert.equal(classifyAcademicWritingDraft({ draft, citationCount: 0 }), 'no-evidence');
assert.equal(hasSubstantiveWritingEvidence([{ excerpt: 'Short title' }]), false);
assert.equal(hasSubstantiveWritingEvidence([{ excerpt: 'This passage provides enough context about reporting transparency and limitations for grounded drafting.' }]), true);

assert.throws(
  () => parseAcademicWritingOutput(JSON.stringify({
    ...draft,
    paragraphs: [
      { role: 'evidence', text: '实验使准确率提高 37.2%。', evidenceMarkers: [], supportStatus: 'supported' },
      draft.paragraphs[1],
    ],
  })),
  /supported.*证据|证据编号/i,
  'Supported prose must not be accepted without paragraph-level evidence markers.',
);

const markdown = buildAcademicWritingMarkdown(draft);
for (const heading of ['写作大纲', '章节草稿', 'Claim-Evidence 映射', '局限与修订清单']) {
  assert.match(markdown, new RegExp(heading), `Artifact should include ${heading}.`);
}
assert.match(markdown, /候选引用仍需回到原文核验/, 'Artifact must preserve citation-verification boundaries.');
assert.doesNotMatch(markdown, /已完成投稿|引用已全部核验|统计检验已经完成/, 'Artifact must not fabricate publication or verification status.');

const routePath = path.join(process.cwd(), 'src/app/api/ai/academic-writing/route.ts');
assert.ok(fs.existsSync(routePath), 'Academic writing should provide a dedicated grounded route.');
const routeSource = fs.readFileSync(routePath, 'utf8');
assert.match(routeSource, /buildGroundedRetrievalContext/, 'Route should use grounded retrieval.');
assert.match(routeSource, /reserveAIUsage/, 'Route should preserve account billing.');
assert.match(routeSource, /llmStream/, 'Route should stream through the real model client.');
assert.match(routeSource, /request\.signal/, 'Route should propagate cancellation.');
assert.match(routeSource, /academic_writing_no_evidence/, 'Route should reject drafting without substantive evidence.');
assert.match(routeSource, /createGroundedSseResponse/, 'Route should delegate SSE headers and cancellation to the grounded lifecycle owner.');

console.log(JSON.stringify({ ok: true, checked: [
  'paragraph roles and claim-evidence mapping are required',
  'supported paragraphs require valid evidence markers',
  'download preserves verification and no-publication boundaries',
  'grounded route preserves billing, streaming, cancellation, and no-evidence rejection',
] }, null, 2));
