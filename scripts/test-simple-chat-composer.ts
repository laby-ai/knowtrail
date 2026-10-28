import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppProvider } from '../src/contexts/AppContext';
import { EditorPanel } from '../src/components/editor/EditorPanel';
import { ResearchChatSkillSelector } from '../src/components/editor/ResearchChatSkillSelector';

// Match Next's JSX runtime when the source is rendered directly by tsx.
Object.assign(globalThis, { React });

const markup = renderToStaticMarkup(
  React.createElement(AppProvider, null, React.createElement(EditorPanel, { compact: true })),
);
const controls = markup.match(/data-testid="chat-skill-shortcuts"[^>]*>([\s\S]*?)<\/div>/)?.[1];
assert.ok(controls, 'The question composer retains its mode control');
assert.equal((controls.match(/<button\b/g) || []).length, 1,
  'Default chat offers one mode control instead of nine choices before a question');
assert.ok(markup.indexOf('data-testid="chat-mode-menu"') > markup.indexOf('data-testid="chat-composer-shell"'),
  'The mode control stays with the question input and source selection');

let selections = 0;
const selected = renderToStaticMarkup(React.createElement(ResearchChatSkillSelector, {
  selectedSkillId: 'academic-writing', onSelect: () => { selections += 1; },
  onClear: () => { selections += 1; }, disabled: false,
}));
assert.match(selected, /学术写作/, 'An active research mode remains visible');
assert.equal(selections, 0, 'Displaying a mode does not select or start a task');
console.log('Simple composer rendering, selected mode visibility and no render side effect passed.');
