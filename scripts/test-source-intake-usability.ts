import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const guide = read('src/components/library/SourceGuideModal.tsx');
const library = read('src/components/library/LibraryPanel.tsx');
const page = read('src/app/page.tsx');

assert.match(library, /data-testid="library-add-source"/, 'Library header needs one primary add-source action');
const addSourceStart = library.indexOf('data-testid="library-add-source"');
const addSourceAction = library.slice(addSourceStart, library.indexOf('</button>', addSourceStart));
assert.match(addSourceAction, /aria-label="添加来源"/, 'The compact source action needs an accessible name');
assert.match(addSourceAction, /\{!compact && "添加来源"\}/, 'The expanded source action must show the expected user language');
assert.match(library, /handleUrlAsSource/, 'Direct URL intake must use the persisted ingestion path');

for (const testId of [
  'source-guide-upload',
  'source-guide-url',
  'source-guide-paste-submit',
  'source-guide-discover',
]) {
  assert.match(guide, new RegExp(`data-testid="${testId}"`), `Unified intake is missing ${testId}`);
}
assert.match(
  guide,
  /useState<SourceMode>\('upload'\)/,
  'Source intake must start with one clear source mode instead of rendering every form at once',
);
for (const mode of ['upload', 'paste', 'url']) {
  assert.match(
    guide,
    new RegExp(`data-testid="source-guide-mode-${mode}"`),
    `Source intake is missing the ${mode} mode selector`,
  );
}
assert.match(
  guide,
  /activeMode === 'upload'[\s\S]{0,1800}activeMode === 'paste'[\s\S]{0,4200}activeMode === 'url'/,
  'Only the selected source form should be visible at a time',
);
assert.match(library, /网页抓取失败/, 'URL intake needs recoverable Chinese failure feedback');
assert.match(library, /网址格式不正确/, 'URL intake needs recoverable format feedback');
assert.match(guide, /正在读取网页/, 'URL intake needs an immediate loading state');
assert.match(
  library,
  /data-testid="library-remove-paper"[\s\S]{0,700}pendingRemovePaperId === paper\.id[\s\S]{0,700}再次点击确认移除/,
  'Source removal must confirm inside the source menu instead of handing the flow to a native browser dialog',
);
assert.match(
  library,
  /data-testid=\{`library-source-menu-\$\{paper\.id\}`\}[\s\S]{0,180}aria-label=\{`管理来源\$\{paper\.title\}`\}/,
  'Each source card needs a discoverable management action',
);
assert.match(
  library,
  /className="!fixed z-\[100\] liquid-glass-card/,
  'The source menu must remain viewport-fixed even though the shared glass card sets relative positioning',
);
assert.match(
  library,
  /data-testid="library-source-detail-panel"[\s\S]{0,240}className="flex h-full w-full flex-col overflow-hidden/,
  'Source reading must replace the library panel in place instead of opening a floating modal',
);
assert.match(library, /来源阅读/, 'The in-place source reader needs a clear panel title');
assert.match(
  library,
  /data-testid=\{`library-source-open-\$\{paper\.id\}`\}[\s\S]{0,220}aria-label=\{`打开来源\$\{paper\.title\}`\}/,
  'Each source needs a real full-card open button',
);
assert.match(
  library,
  /className="pointer-events-none relative z-10 flex-1 min-w-0"/,
  'Source-card text must not block the full-card open target',
);
assert.match(
  library,
  /data-testid="library-citation-focus"[\s\S]{0,180}pointer-events-auto/,
  'Citation controls must remain independently interactive inside a full-card open target',
);
assert.match(
  page,
  /<AcademicPresenterContent[\s\S]{0,500}accountAuthRequired=\{accountAuthRequired\}/,
  'Embedded paper-host guests must use the resolved auth boundary so persisted sources restore after refresh',
);

console.log('source intake usability contract passed');
