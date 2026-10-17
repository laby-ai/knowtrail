import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const chatSkillsPath = path.join(process.cwd(), 'src/lib/research-chat-skills.ts');
assert.ok(fs.existsSync(chatSkillsPath), 'Research chat should define a shared Skills contract');

const chatSkillsSource = fs.readFileSync(chatSkillsPath, 'utf8');
const editorSource = read('src/components/editor/EditorPanel.tsx');
const skillSelectorSource = read('src/components/editor/ResearchChatSkillSelector.tsx');
const chatRouteSource = read('src/app/api/ai/chat/route.ts');
const studioTaxonomySource = read('src/lib/studio-research-taxonomy.ts');

for (const skillId of [
  'paper-search',
  'deep-research',
  'literature-review',
  'hypothesis-generation',
  'experiment-design',
  'academic-writing',
  'text-polishing',
  'peer-review',
]) {
  assert.match(chatSkillsSource, new RegExp(`id: '${skillId}'`), `${skillId} should be available in the middle chat`);
}

assert.match(skillSelectorSource, /aria-pressed=\{selectedSkillId === skill.id\}/, 'The selected Skill should remain visible beside the composer');
assert.match(skillSelectorSource, /data-testid="chat-skill-shortcuts"/, 'Common Skills should stay visible inside the composer toolbar');
assert.match(skillSelectorSource, /普通问答/, 'The composer toolbar should provide an explicit return to normal chat');
assert.match(skillSelectorSource, /RESEARCH_CHAT_SKILLS\.map/, 'Every research Skill should remain directly reachable from the composer toolbar');
assert.match(skillSelectorSource, /quiet-mode-bar/, 'The existing direct mode row should remain available');
assert.doesNotMatch(skillSelectorSource, />更多</, 'The composer should not hide research Skills behind a More action');
assert.doesNotMatch(skillSelectorSource, /chat-skill-menu|chat-skill-group-/, 'The composer should not reintroduce a grouped popover');
assert.match(editorSource, /data-testid="chat-composer-shell"/, 'The prompt input and Skill shortcuts should share one composer surface');
assert.match(
  editorSource,
  /data-testid="chat-composer-shell"[\s\S]*w-full rounded-\[22px\]/,
  'The conversation composer should use the full width of the center workspace',
);
assert.match(
  editorSource,
  /data-testid="chat-composer-shell"[\s\S]*textarea[\s\S]*ResearchChatSkillSelector/,
  'All modes remain reachable without replacing the conversation service',
);
assert.match(editorSource, /clearChatSkill/, 'The selected Skill should be removable without clearing the draft');
assert.match(editorSource, /sendQuestion\(draft, \{ skill: selectedChatSkill \}\)/, 'Normal chat submissions should use the selected Skill');
assert.match(editorSource, /skill: options\.skill \|\| undefined/, 'Chat requests should send the selected Skill to the server');
assert.match(editorSource, /clientApiPath\('\/api\/agent\/chat'\)/, 'All Skill submissions should use the AgentScope orchestration endpoint');
assert.doesNotMatch(editorSource, /chat-skill-workspace|hidden=\{workspaceSkillActive\}/, 'Choosing a Skill must keep the existing conversation visible');
assert.match(read('src/components/editor/MessageItem.tsx'), /AgentToolCard/, 'Tool results should be attached to their conversation turn');
assert.match(chatRouteSource, /resolveResearchChatSkillInstruction\(skill\)/, 'The chat route should resolve server-owned Skill instructions');
assert.match(chatRouteSource, /skillInstruction/, 'The server should add the Skill instruction without exposing it as user text');
assert.match(
  studioTaxonomySource,
  /CHAT_SKILL_PRODUCT_IDS[\s\S]*filter\(product => !CHAT_SKILL_PRODUCT_IDS\.has\(product\.id\)\)/,
  'Chat-first tools should no longer be duplicated in the right product directory',
);

console.log(JSON.stringify({
  ok: true,
  checked: [
    'all eight research Skills are directly visible in the conversation composer',
    'the selected Skill is visible and removable',
    'Skill selection keeps the current conversation visible',
    'chat submissions carry the selected Skill',
    'all submissions reuse server-owned evidence and instructions',
    'server-owned Skill instructions shape model behavior',
    'right product directory does not duplicate chat-first tools',
  ],
}, null, 2));
