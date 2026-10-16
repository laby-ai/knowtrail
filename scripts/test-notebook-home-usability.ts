import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const home = read('src/components/home/NotebookHome.tsx');
const cards = read('src/components/home/NotebookCards.tsx');
const page = read('src/app/page.tsx');
const featured = read('src/components/home/featured-notebooks.ts');
const library = read('src/components/library/LibraryPanel.tsx');
const quietWorkbench = read('src/styles/quiet-research-workbench.css');

assert.match(quietWorkbench, /--quiet-bg: #eaf1f8;/, 'The workbench needs a visible fog-blue page base');
assert.match(quietWorkbench, /--quiet-panel: #fbfcfe;/, 'The three columns need a warm-white surface');
assert.match(quietWorkbench, /--quiet-panel-muted: #f5f8fc;/, 'Muted panel areas need a distinct light surface');
assert.match(quietWorkbench, /--quiet-border: #d8e2ee;/, 'Panel borders must remain soft on the new page base');

assert.match(home, /projectNotebookHome/, 'Notebook filters, sorting and view controls must drive the rendered projection');
assert.match(home, /notebook-home-filter-\$\{value\}/, 'Notebook range buttons need stable test targets');
assert.match(home, /\['mine', '我的文献本'\]/, 'Personal notebooks need a real filter');
assert.match(home, /\['featured', '精选模板'\]/, 'Featured notebooks need a real filter');
assert.match(home, /notebook-home-sort/, 'Notebook sorting needs a real select control');
assert.match(home, /notebook-home-view-grid/, 'Notebook grid view needs a real control');
assert.match(home, /notebook-home-view-list/, 'Notebook list view needs a real control');
assert.match(home, /data-testid="notebook-home-search"/, 'Notebook search must remain a real control');
assert.match(home, /preferencesStorageKey/, 'Notebook home controls must restore within the current guest or account scope');
assert.match(home, /decodeNotebookHomePreferences/, 'Notebook home controls must validate restored preferences');
assert.match(home, /encodeNotebookHomePreferences/, 'Notebook home controls must persist the visible selection');
assert.match(home, /没有匹配的文献本/, 'Search needs an explicit empty result state');
assert.match(home, /清除搜索/, 'Search empty state needs a recovery action');
assert.match(home, /focus-visible:ring-/, 'Home commands need visible keyboard focus');

assert.match(cards, /grid-cols-2[\s\S]*sm:grid-cols-4/, 'Featured notebooks must fit one row on normal desktop widths');
assert.match(cards, /view === 'list' \? 'space-y-2'/, 'Featured notebooks must visibly respond to list view');
assert.match(home, /<FeaturedNotebookStrip[\s\S]*view=\{view === 'list' \? 'list' : 'grid'\}/, 'Featured view must follow the selected home view');
assert.match(cards, /min-h-\[140px\]/, 'Featured cards must use a compact stable height');
assert.match(cards, /min-h-\[184px\]/, 'Notebook cards must avoid the previous oversized layout');
assert.match(cards, /data-testid={`notebook-home-actions-\$\{notebook\.id\}`}/, 'Notebook cards need a real lifecycle menu');
assert.match(cards, />\s*管理\s*</, 'Notebook lifecycle actions need a visible management label');
assert.match(cards, /aria-haspopup="menu"/, 'Notebook management controls must expose menu semantics');
assert.match(cards, /role="menu"/, 'Notebook lifecycle options must render as an explicit menu');
assert.match(cards, /view === 'list' \? 'bottom-10' : 'top-10'/, 'List lifecycle menus must open upward so archive stays inside the viewport');
assert.match(cards, /重命名/, 'Notebook cards must expose rename');
assert.match(cards, /归档/, 'Notebook cards must expose archive');
assert.match(cards, /ArrowUpRight/, 'Open action must remain visible without relying on hover');
assert.match(cards, /focus-visible:ring-/, 'Cards need visible keyboard focus');
assert.match(cards, /pointer-events-none[\s\S]*item\.title/, 'Featured card content must not intercept the full-card click target');
assert.match(cards, /创建个人副本/, 'Featured cards must explain that using a template creates an independent notebook copy');
assert.match(featured, /ingestionChunkCount: sampleChunkCount\(input\.content\)/, 'Featured source counts must describe the readable sample content');
assert.match(library, /localSourcePreviewFromPaper/, 'Featured sources need a local readable preview when no ingestion record exists');
assert.match(library, /示例来源 · 已随模板保存在当前副本中/, 'Featured source reading must clearly label saved template content');
assert.match(library, /border-blue-200 bg-blue-50\/80/, 'Source-reading evidence cards need readable contrast on the light workbench');

assert.match(home, /已归档/, 'Archived notebooks need a visible recovery section');
assert.match(home, /恢复/, 'Archived notebooks need a restore action');
assert.match(home, /重命名文献本/, 'Rename needs a clear dialog instead of a prompt');
assert.match(
  page,
  /notebooksStorageOwner !== notebookStorageOwner/,
  'Workbench refresh must not render notebooks from a previous host scope while the current scope is restored',
);
assert.match(
  page,
  /preferencesStorageKey=\{notebookStorageKey\('knowtrail-notebook-home-preferences'\)\}/,
  'Notebook home preferences must be isolated with the same guest or account owner as notebook data',
);

console.log('notebook home usability contract passed');
