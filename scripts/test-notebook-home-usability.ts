import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const home = read('src/components/home/NotebookHome.tsx');
const cards = read('src/components/home/NotebookCards.tsx');

for (const deadControl of ['网格视图', '卡片视图', '列表视图', '>最新<', '>全部<', '>我的文献本<']) {
  assert.ok(!home.includes(deadControl), `Notebook home must not expose non-functional control: ${deadControl}`);
}

assert.doesNotMatch(home, /\bCheck\b|\bChevronDown\b|\bGrid3X3\b|\bList\b/, 'Dead view-control icons must be removed');
assert.match(home, /data-testid="notebook-home-search"/, 'Notebook search must remain a real control');
assert.match(home, /没有匹配的文献本/, 'Search needs an explicit empty result state');
assert.match(home, /清除搜索/, 'Search empty state needs a recovery action');
assert.match(home, /focus-visible:ring-/, 'Home commands need visible keyboard focus');

assert.match(cards, /grid-cols-2[\s\S]*sm:grid-cols-4/, 'Featured notebooks must fit one row on normal desktop widths');
assert.match(cards, /min-h-\[140px\]/, 'Featured cards must use a compact stable height');
assert.match(cards, /min-h-\[184px\]/, 'Notebook cards must avoid the previous oversized layout');
assert.doesNotMatch(cards, /MoreVertical/, 'Notebook cards must not show a fake overflow menu');
assert.match(cards, /ArrowUpRight/, 'Open action must remain visible without relying on hover');
assert.match(cards, /focus-visible:ring-/, 'Cards need visible keyboard focus');

console.log('notebook home usability contract passed');
