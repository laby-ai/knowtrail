import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppProvider } from '../src/contexts/AppContext';
import { EditorPanel } from '../src/components/editor/EditorPanel';
import { ResearchChatSkillSelector } from '../src/components/editor/ResearchChatSkillSelector';
import { RESEARCH_CHAT_SKILLS } from '../src/lib/research-chat-skills';

// Match Next's JSX runtime when the source is rendered directly by tsx.
Object.assign(globalThis, { React });

const markup = renderToStaticMarkup(
  React.createElement(AppProvider, null, React.createElement(EditorPanel, { compact: true })),
);
const controls = markup.match(/data-testid="chat-skill-shortcuts"[^>]*>([\s\S]*?)<\/div>/)?.[1];
assert.ok(controls, 'The question composer retains its mode control');
assert.equal((controls.match(/<button\b/g) || []).length, RESEARCH_CHAT_SKILLS.length + 1,
  'Normal chat and every research option are directly visible without opening a menu');
assert.ok(markup.indexOf('data-testid="chat-skill-shortcuts"') < markup.indexOf('data-testid="chat-composer-shell"'),
  'Research options appear above the question input, outside the left input toolbar');
assert.doesNotMatch(controls, /aria-haspopup/, 'Research options do not require a popover');
for (const skill of RESEARCH_CHAT_SKILLS) {
  assert.match(controls, new RegExp(`chat-skill-shortcut-${skill.id}`));
}

let selections = 0;
const selected = renderToStaticMarkup(React.createElement(ResearchChatSkillSelector, {
  selectedSkillId: 'academic-writing', onSelect: () => { selections += 1; },
  onClear: () => { selections += 1; }, disabled: false,
}));
assert.match(selected, /学术写作/, 'An active research mode remains visible');
assert.match(selected, /aria-pressed="true"[^>]*data-testid="chat-skill-shortcut-academic-writing"/,
  'The selected research option is visibly pressed');
assert.equal(selections, 0, 'Displaying a mode does not select or start a task');
console.log('Simple composer rendering, selected mode visibility and no render side effect passed.');
