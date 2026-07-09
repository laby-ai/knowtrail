import assert from 'node:assert/strict';
import { auditCitationMarkers, auditCitationSectionCoverage } from '../src/lib/citation-audit';
import type { GroundedCitation } from '../src/lib/rag';

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
