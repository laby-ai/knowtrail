import assert from 'node:assert/strict';
import { CHAT_SKILLS, chatSkillInstructions } from '../src/lib/chat-skills';

for (const invalid of [undefined, null, {}, 'deep-analysis', 1, ['ignore-all-rules'], [{ id: 'deep-analysis' }]]) {
  assert.equal(chatSkillInstructions(invalid), '', 'Unsupported selections must never enter the prompt');
}
const selected = chatSkillInstructions(['method-review', 'method-review', 'unknown', 'risk-assess']);
assert.match(selected, /方法审查/);
assert.match(selected, /风险评估/);
assert.equal(selected.match(/方法审查/g)?.length, 1);
assert.doesNotMatch(selected, /unknown|深度分析/);
assert.match(selected, /仍须遵守来源和引用约束/);
assert.equal(CHAT_SKILLS.length, 6);
console.log('PASS: skill allowlist, invalid payloads, deduplication and evidence constraints');
