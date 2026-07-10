import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  consumeDeepResearchSse,
  createDeepResearchProbeBody,
  validateDeepResearchResult,
} from './lib/live-deep-research-smoke.mjs';

function streamFrom(events) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event));
      controller.close();
    },
  });
}

const probe = createDeepResearchProbeBody();
assert.match(probe.question, /证据/, 'The probe should ask a bounded evidence question.');
assert.equal(probe.papers.length, 1, 'The probe should use one deterministic source.');
assert.ok(probe.papers[0].content.length >= 120, 'The probe source should contain substantive evidence.');

const result = await consumeDeepResearchSse(streamFrom([
  'data: {"progress":{"stage":"evidence-ready","progress":28},"citations":[{"sourceId":"live-deep-research-source","excerpt":"substantive evidence"}],"retrieval":{"sourceCount":1}}\n\n',
  'data: {"progress":{"stage":"writing","progress":52}}\n\n',
  'data: {"content":"## 研究问题\\n证据链如何降低研究结论偏差[1]？\\n\\n## 研究边界\\n仅使用给定来源[1]。\\n\\n"}\n\n',
  'data: {"content":"## 关键词\\n证据链、复核[1]。\\n\\n## 证据来源\\n给定方法说明[1]。\\n\\n## 主要结论\\n显式记录可提升复核性[1]。\\n\\n## 分论点\\n记录来源与限制[1]。\\n\\n## 争议或不足\\n未提供量化比较[1]。\\n\\n## 可实操路线\\n记录问题、来源和排除理由[1]。\\n\\n## 还需要核验\\n需在真实项目中复核[1]。"}\n\n',
  'data: {"progress":{"stage":"auditing","progress":90}}\n\n',
  'data: {"replaceContent":"## 研究问题\\n证据链如何降低研究结论偏差[1]？\\n\\n## 研究边界\\n仅使用给定来源[1]。\\n\\n## 关键词\\n证据链、复核[1]。\\n\\n## 证据来源\\n给定方法说明[1]。\\n\\n## 主要结论\\n显式记录可提升复核性[1]。\\n\\n## 分论点\\n记录来源与限制[1]。\\n\\n## 争议或不足\\n未提供量化比较[1]。\\n\\n## 可实操路线\\n记录问题、来源和排除理由[1]。\\n\\n## 还需要核验\\n需在真实项目中复核[1]。","citationAudit":{"status":"pass"},"researchStatus":{"answerStatus":"complete","sectionCoverage":{"status":"pass"},"removedUncitedClaims":2},"billing":{"status":"settled"}}\n\n',
  'data: [DONE]\n\n',
]));

const summary = validateDeepResearchResult(result);
assert.equal(summary.answerStatus, 'complete');
assert.equal(summary.citationAuditStatus, 'pass');
assert.equal(summary.sectionCoverageStatus, 'pass');
assert.equal(summary.citationCount, 1);
assert.deepEqual(summary.progressStages, ['evidence-ready', 'writing', 'auditing']);
assert.ok(summary.answerChars > 100);
assert.equal(summary.removedUncitedClaims, 2);

await assert.rejects(
  () => consumeDeepResearchSse(streamFrom(['data: {"error":"provider failed","errorType":"deep_research_failed"}\n\n'])),
  /provider failed/,
  'Provider failures must fail the live smoke.',
);

assert.throws(
  () => validateDeepResearchResult({ ...result, researchStatus: { answerStatus: 'incomplete', sectionCoverage: { status: 'pass' } } }),
  /complete/,
  'Incomplete reports must not pass the live smoke.',
);

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.equal(packageJson.scripts?.['smoke:live-deep-research'], 'node ./scripts/smoke-live-deep-research.mjs');
assert.equal(packageJson.scripts?.['test:live-deep-research-smoke'], 'node ./scripts/test-live-deep-research-smoke.mjs');
assert.match(packageJson.scripts?.validate || '', /test:live-deep-research-smoke/);
assert.ok(fs.existsSync('scripts/smoke-live-deep-research.mjs'));

console.log(JSON.stringify({
  ok: true,
  checked: [
    'probe uses a bounded deterministic evidence source',
    'SSE parser preserves progress, citations, content, audits, billing, and done',
    'provider errors and incomplete reports fail closed',
    'runner and validation entrypoints remain wired',
  ],
}, null, 2));
