import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildPaperReadingMarkdown,
  buildPaperReadingPrompt,
  classifyPaperReadingResult,
  parsePaperReadingOutput,
} from '../src/lib/paper-reading-contract';

const evidenceContext = `[1] A controlled study
摘录: Structured reading helps readers distinguish methods, findings, and limitations.`;

for (const mode of ['translation', 'paragraph-summary', 'full-summary'] as const) {
  const prompt = buildPaperReadingPrompt({
    mode,
    sourceTitle: 'A controlled study',
    sourceLanguage: 'English',
    targetLanguage: '简体中文',
    sourceCount: 1,
    evidenceContext,
  });
  assert.match(prompt, new RegExp(mode), `${mode} prompt should identify its machine-readable mode.`);
  assert.match(prompt, /evidenceMarkers/, `${mode} prompt should require paragraph-level evidence markers.`);
  assert.match(prompt, /不得编造|只能使用/, `${mode} prompt should prohibit unsupported claims.`);
}

const result = parsePaperReadingOutput(JSON.stringify({
  title: '结构化精读结果',
  mode: 'full-summary',
  sourceLanguage: 'English',
  targetLanguage: '简体中文',
  sections: [
    { label: '研究背景', sourceText: '', content: '研究关注结构化阅读如何帮助读者辨析论文信息[1]。', evidenceMarkers: [1] },
    { label: '研究问题', sourceText: '', content: '核心问题是能否稳定区分方法、发现与局限[1]。', evidenceMarkers: [1] },
    { label: '研究方法', sourceText: '', content: '来源描述了一项受控研究[1]。', evidenceMarkers: [1] },
    { label: '主要发现', sourceText: '', content: '结构化阅读有助于区分方法、发现与局限[1]。', evidenceMarkers: [1] },
    { label: '创新贡献', sourceText: '', content: '当前片段仅支持阅读组织层面的贡献[1]。', evidenceMarkers: [1] },
    { label: '局限', sourceText: '', content: '当前仅有一个证据片段，不能外推到其他任务。', evidenceMarkers: [] },
  ],
  keyTerms: [{ source: 'structured reading', target: '结构化阅读' }],
  limitations: ['候选证据仍需回到原文核验。'],
}));

assert.equal(result.sections.length, 6);
assert.equal(classifyPaperReadingResult({ result, citationCount: 1 }), 'complete');
assert.equal(classifyPaperReadingResult({ result, citationCount: 0 }), 'no-evidence');

assert.throws(
  () => parsePaperReadingOutput(JSON.stringify({
    ...result,
    sections: [{ label: '主要发现', sourceText: '', content: '准确率提高37%。', evidenceMarkers: [] }],
  })),
  /证据编号|evidence/i,
  'Substantive sections must not be accepted without evidence markers.',
);

const markdown = buildPaperReadingMarkdown(result);
for (const heading of ['研究背景', '研究问题', '研究方法', '主要发现', '创新贡献', '局限']) {
  assert.match(markdown, new RegExp(heading), `Structured summary should retain ${heading}.`);
}
assert.match(markdown, /回到原文核验/, 'Export must preserve source-verification boundaries.');

const routePath = path.join(process.cwd(), 'src/app/api/ai/paper-reading/route.ts');
const panelPath = path.join(process.cwd(), 'src/components/studio/PaperReadingPanel.tsx');
const taxonomyPath = path.join(process.cwd(), 'src/lib/studio-research-taxonomy.ts');
for (const filePath of [routePath, panelPath]) {
  assert.ok(fs.existsSync(filePath), `${path.basename(filePath)} should exist.`);
}

const routeSource = fs.readFileSync(routePath, 'utf8');
assert.match(routeSource, /buildGroundedRetrievalContext/, 'Route should use grounded retrieval.');
assert.match(routeSource, /reserveAIUsage/, 'Route should preserve account billing.');
assert.match(routeSource, /llmStream/, 'Route should use the managed streaming model client.');
assert.match(routeSource, /request\.signal/, 'Route should propagate cancellation.');
assert.doesNotMatch(routeSource, /doubao-seed|ep-\d+/i, 'Route must not hardcode a provider model id.');

const panelSource = fs.readFileSync(panelPath, 'utf8');
for (const label of ['外文翻译', '逐段总结', '全文结构化总结']) {
  assert.match(panelSource, new RegExp(label), `Panel should expose ${label}.`);
}
assert.match(panelSource, /getSelectedPapers/, 'Panel should reuse the existing selected-source workflow.');
assert.match(panelSource, /accountAuthHeaders/, 'Panel should preserve portal account authentication.');

const taxonomySource = fs.readFileSync(taxonomyPath, 'utf8');
assert.match(taxonomySource, /paper-reading/, 'Paper reading should be an active Studio product.');

console.log(JSON.stringify({
  ok: true,
  checked: [
    'translation, paragraph summary, and full structured summary share one contract',
    'substantive sections require evidence markers',
    'managed model, billing, cancellation, and portal authentication remain mandatory',
    'paper reading is visible in the existing KnowTrail Studio',
  ],
}, null, 2));
