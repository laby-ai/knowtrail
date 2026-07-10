import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  auditTextPolishing,
  buildPolishingMarkdown,
  buildTextPolishingPrompt,
  buildTextProtection,
  parseTextPolishingOutput,
} from '../src/lib/text-polishing-contract';

const sourceText = 'Model-X 在数据集 A 上的准确率为 87.4%（p=0.03；见图2）[12]。该结果提示模型性能可能改善。';
const protection = buildTextProtection(sourceText, ['Model-X', '数据集 A']);
for (const token of ['Model-X', '数据集 A', '87.4%', 'p=0.03', '图2', '[12]']) {
  assert.ok(protection.items.includes(token), `Protection snapshot should preserve ${token}.`);
}

const prompt = buildTextPolishingPrompt({
  sourceText,
  goal: '减少模板腔，保持论文正文的保守语气。',
  scene: 'paper',
  protection,
});
assert.match(prompt, /默认少动|最小修改/, 'Prompt should require minimal revision.');
assert.match(prompt, /数字、单位、术语、引用和图表编号/, 'Prompt should protect scientific tokens.');
assert.match(prompt, /不得把相关性.*因果|不得新增.*显著/, 'Prompt should prohibit claim-strength escalation.');

const result = parseTextPolishingOutput(JSON.stringify({
  revisedText: '在数据集 A 上，Model-X 的准确率为 87.4%（p=0.03；见图2）[12]。这一结果提示模型性能可能有所改善。',
  changes: [
    { original: 'Model-X 在数据集 A 上的准确率为', revised: '在数据集 A 上，Model-X 的准确率为', reason: '调整语序以提高可读性。', category: 'flow' },
    { original: '该结果提示模型性能可能改善', revised: '这一结果提示模型性能可能有所改善', reason: '保持原有不确定性并减少生硬表达。', category: 'tone' },
  ],
  remainingRisks: ['p 值对应的统计检验仍需作者核验。'],
}));
const audit = auditTextPolishing(sourceText, result, protection);
assert.equal(audit.safe, true);
assert.deepEqual(audit.missingProtectedItems, []);
assert.deepEqual(audit.strengthenedClaims, []);

const unsafe = parseTextPolishingOutput(JSON.stringify({
  ...result,
  revisedText: 'Model-X 在数据集 A 上证明了性能显著提升（见图2）[12]。',
}));
const unsafeAudit = auditTextPolishing(sourceText, unsafe, protection);
assert.equal(unsafeAudit.safe, false, 'Missing numbers and strengthened claims must fail the audit.');
assert.ok(unsafeAudit.missingProtectedItems.includes('87.4%'));
assert.ok(unsafeAudit.missingProtectedItems.includes('p=0.03'));
assert.ok(unsafeAudit.strengthenedClaims.some(item => /证明|显著/.test(item)));

const markdown = buildPolishingMarkdown(sourceText, result, audit);
for (const heading of ['原文', '修订文', '修改说明', '保护项检查', '仍需确认']) {
  assert.match(markdown, new RegExp(heading), `Artifact should include ${heading}.`);
}
assert.doesNotMatch(markdown, /引用已核验|事实已确认|投稿已完成/, 'Artifact must not fabricate verification or submission status.');

const routePath = path.join(process.cwd(), 'src/app/api/ai/text-polishing/route.ts');
assert.ok(fs.existsSync(routePath), 'Text polishing should provide a dedicated server route.');
const routeSource = fs.readFileSync(routePath, 'utf8');
assert.match(routeSource, /reserveAIUsage/, 'Route should preserve account billing.');
assert.match(routeSource, /llmStream/, 'Route should use the real streaming model client.');
assert.match(routeSource, /request\.signal/, 'Route should propagate cancellation.');
assert.match(routeSource, /auditTextPolishing/, 'Route should deterministically audit protected facts and claim strength.');
assert.match(routeSource, /text_polishing_unsafe_output/, 'Unsafe model output should have a stable error type.');
assert.match(routeSource, /X-Accel-Buffering[^\n]+no/, 'Route should disable proxy buffering.');

console.log(JSON.stringify({ ok: true, checked: [
  'scientific numbers, terms, citations, and figure references are snapshotted',
  'minimal-edit prompt prohibits claim-strength escalation',
  'deterministic audit rejects missing protected items and stronger claims',
  'download preserves original, revision, reasons, audit, and remaining risks',
] }, null, 2));
