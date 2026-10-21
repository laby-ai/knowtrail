import assert from 'node:assert/strict';
import { auditCitationMarkers, auditCitationSectionCoverage, auditCitationQuantities } from '../src/lib/citation-audit';
import type { GroundedCitation } from '../src/lib/rag';
import recorded from './fixtures/citation-support-8832b8c.json';

const citations: GroundedCitation[] = [
  {
    paperId: 'paper-a',
    paperShortName: 'A. 2026',
    sourceId: 'paper-a',
    chunkId: 'paper-a::chunk-1',
    chunkIndex: 0,
    sourceTitle: 'A source',
    excerpt: 'first evidence',
    score: 10,
  },
  {
    paperId: 'paper-a',
    paperShortName: 'A. 2026',
    sourceId: 'paper-a',
    chunkId: 'paper-a::chunk-2',
    chunkIndex: 1,
    sourceTitle: 'A source',
    excerpt: 'second evidence',
    score: 8,
  },
];

const pass = auditCitationMarkers('结论来自证据[1]，对照结果见[2]。', citations);
assert.equal(pass.status, 'pass');
assert.deepEqual(pass.citedNumbers, [1, 2]);
assert.deepEqual(pass.invalidNumbers, []);

const missing = auditCitationMarkers('结论来自检索证据，但模型没有标号。', citations);
assert.equal(missing.status, 'missing-markers');
assert.deepEqual(missing.uncitedNumbers, [1, 2]);
assert.ok(missing.warning?.includes('没有使用任何引用编号'));

const invalid = auditCitationMarkers('结论来自证据[1]，但还引用了不存在的[3]。', citations);
assert.equal(invalid.status, 'invalid-markers');
assert.deepEqual(invalid.invalidNumbers, [3]);
assert.deepEqual(invalid.uncitedNumbers, [2]);

const none = auditCitationMarkers('没有检索证据时不强制引用。', []);
assert.equal(none.status, 'none');
assert.deepEqual(none.citedNumbers, []);

const sectionCoveragePass = auditCitationSectionCoverage([
  '## 核心发现',
  '主要结果支持研究假设[1]。',
  '## 与既有研究的关系',
  '该趋势与既有研究一致[2]。',
  '## 可支持解释',
  '当前证据支持一种谨慎解释[1]。',
].join('\n'), ['核心发现', '与既有研究的关系', '可支持解释']);
assert.equal(sectionCoveragePass.status, 'pass');
assert.deepEqual(sectionCoveragePass.uncitedClaims, []);

const sectionCoverageMissing = auditCitationSectionCoverage([
  '## 核心发现',
  '主要结果支持研究假设[1]。',
  '## 与既有研究的关系',
  '该趋势与既有研究一致。',
  '## 可支持解释',
  '当前证据支持一种机制解释。',
].join('\n'), ['核心发现', '与既有研究的关系', '可支持解释']);
assert.equal(sectionCoverageMissing.status, 'missing-claim-citations');
assert.deepEqual(sectionCoverageMissing.uncitedClaims.map(item => item.section), ['与既有研究的关系', '可支持解释']);

const sameLineCoverageMissing = auditCitationSectionCoverage([
  '## 核心发现',
  '主要结果支持研究假设[1]。另一项观察仍缺少来源。',
  '## 与既有研究的关系',
  '该趋势与既有研究一致[2]。',
  '## 可支持解释',
  '当前证据支持一种谨慎解释[1]。',
].join('\n'), ['核心发现', '与既有研究的关系', '可支持解释']);
assert.equal(sameLineCoverageMissing.status, 'missing-claim-citations');
assert.deepEqual(sameLineCoverageMissing.uncitedClaims.map(item => item.text), ['另一项观察仍缺少来源。']);

const nestedHeadingCoverageMissing = auditCitationSectionCoverage([
  '## 核心发现',
  '主要结果支持研究假设[1]。',
  '### 补充观察',
  '这项补充观察没有来源。',
  '## 与既有研究的关系',
  '该趋势与既有研究一致[2]。',
  '## 可支持解释',
  '当前证据支持一种谨慎解释[1]。',
].join('\n'), ['核心发现', '与既有研究的关系', '可支持解释']);
assert.equal(nestedHeadingCoverageMissing.status, 'missing-claim-citations');
assert.deepEqual(nestedHeadingCoverageMissing.uncitedClaims.map(item => item.text), ['这项补充观察没有来源。']);

const emptySectionCoverage = auditCitationSectionCoverage([
  '## 核心发现',
  '## 与既有研究的关系',
  '该趋势与既有研究一致[2]。',
  '## 可支持解释',
  '当前证据支持一种谨慎解释[1]。',
].join('\n'), ['核心发现', '与既有研究的关系', '可支持解释']);
assert.equal(emptySectionCoverage.status, 'missing-section-claims');
assert.deepEqual(emptySectionCoverage.emptySections, ['核心发现']);

for (const academicCitation of [
  '该结果与 Smith et al. [1] 的发现一致。',
  '该结果与既有示例（e.g. Smith, 2024）一致[1]。',
  '该结果与 J. R. Smith 的观察一致[1]。',
  'Smith, J. [1] 报告了相同趋势。',
  'Smith J. [1] 报告了相同趋势。',
  'Smith, J. R. [1] 报告了相同趋势。',
]) {
  const academicCoverage = auditCitationSectionCoverage([
    '## 核心发现',
    '主要结果支持研究假设[1]。',
    '## 与既有研究的关系',
    academicCitation,
    '## 可支持解释',
    '当前证据支持一种谨慎解释[1]。',
  ].join('\n'), ['核心发现', '与既有研究的关系', '可支持解释']);
  assert.equal(academicCoverage.status, 'pass', `academic citation should not be split: ${academicCitation}`);
}

for (const sample of recorded.cases) {
  const original = JSON.stringify(sample);
  const checked = auditCitationQuantities(sample.answer, sample.citations, sample.chunks);
  assert.equal(checked.status, sample.expected, `Actual acceptance ${sample.id}: valid markers do not prove a number is in the cited chunk`);
  assert.equal(JSON.stringify(sample), original, 'Audit must not rewrite the answer or renumber actual citations');
}

const comparison = recorded.cases.find(sample => sample.id === 'cross-source')!;
const comparisonAudit = auditCitationQuantities(comparison.answer, comparison.citations, comparison.chunks);
assert.deepEqual(comparisonAudit.numericSupport?.missing.map(item => item.citations), [[6]]);
assert.deepEqual(comparisonAudit.numericSupport?.missing.flatMap(item => item.values), ['6.5米']);
assert.equal(auditCitationMarkers(comparison.answer, comparison.citations).status, 'pass', 'The existing marker-only contract stays unchanged');
const fact = recorded.cases.find(sample => sample.id === 'fact')!;
assert(!fact.citations[1].excerpt.includes('6.5'), 'Actual supporting fact is beyond the card preview');
assert.equal(auditCitationQuantities(fact.answer, fact.citations, fact.chunks).status, 'pass');
assert.equal(auditCitationQuantities('值为6.5米[37]。', fact.citations, fact.chunks).status, 'invalid-markers');
assert.equal(auditCitationQuantities('一般问题没有资料。', [], []).status, 'none');
const isolatedCitation = [fact.citations[1]];
const isolatedChunk = [fact.chunks[1]];
assert.equal(auditCitationQuantities('主镜直径6.5米[1]。', isolatedCitation, [{ ...isolatedChunk[0], text: '16.5 m' }]).status, 'needs-review', 'A substring of another number is not support');
assert.equal(auditCitationQuantities('主镜直径6.50米[1]。', isolatedCitation, isolatedChunk).status, 'pass');
const foreignChunk = [{ ...isolatedChunk[0], sourceId: 'foreign-owner-source', text: '6.5 m' }];
const unavailable = auditCitationQuantities('主镜直径6.5米[1]。', isolatedCitation, foreignChunk);
assert.equal(unavailable.status, 'needs-review');
assert.deepEqual(unavailable.numericSupport?.unavailableCitations, [1]);
assert.deepEqual(unavailable.numericSupport?.missing, [], 'Unreadable identity is not proof that the original lacks a value');
assert.equal(auditCitationQuantities('长度1000米[1]。', isolatedCitation, [{ ...isolatedChunk[0], text: '1,000 m' }]).status, 'pass');
assert.equal(auditCitationQuantities('温度−2 K[1]。', isolatedCitation, [{ ...isolatedChunk[0], text: '-2 K' }]).status, 'pass');
assert.equal(auditCitationQuantities('长度6.5e-3米[1]。', isolatedCitation, [{ ...isolatedChunk[0], text: '0.0065 m' }]).status, 'pass');
assert.equal(auditCitationQuantities('主镜直径650厘米[1]。', isolatedCitation, isolatedChunk).status, 'needs-review', 'A derived or converted value needs review, not automatic correction');

console.log(JSON.stringify({
  ok: true,
  checked: [
    'citation audit passes valid markers',
    'citation audit flags missing markers when citations exist',
    'citation audit flags invalid marker numbers',
    'citation audit does not require markers without citations',
    'section citation coverage passes when every claim line is cited',
    'section citation coverage identifies uncited comparison and interpretation claims',
    'section citation coverage audits every sentence on the same line',
    'section citation coverage preserves required section scope across nested headings',
    'section citation coverage rejects required sections without substantive claims',
    'section citation coverage preserves et al., e.g., and surname-first or surname-last author initials',
  ],
  statuses: [pass.status, missing.status, invalid.status, none.status],
}, null, 2));
