import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractPaperSections } from '../src/lib/paper-structure';

const sections = extractPaperSections(`
Evidence-Grounded Research Workbench
Alice Zhang, Bo Li

Abstract
This paper studies evidence-grounded research workflows.

1 Introduction
Research workbenches need traceable evidence.

2.1 Retrieval Method
We retrieve balanced evidence from multiple papers.

3 Results
The method improves source coverage.

4 Discussion
The result remains limited by document quality.

References
[1] Example reference.
`);

assert.deepEqual(
  sections.map(section => section.title),
  ['Abstract', '1 Introduction', '2.1 Retrieval Method', '3 Results', '4 Discussion', 'References'],
);
assert.equal(sections[0].level, 1);
assert.equal(sections[2].level, 2);
assert.match(sections[2].excerpt, /balanced evidence/);
assert.match(sections[3].excerpt, /source coverage/);

const chineseSections = extractPaperSections(`
论文精读的证据链设计

摘要
本文研究论文精读中的证据追溯。

一、研究背景
现有工具容易丢失原文定位。

二、研究方法
本文按章节切分并保留页码。

三、结论
结构化章节可以提升复核效率。
`);

assert.deepEqual(
  chineseSections.map(section => section.title),
  ['摘要', '一、研究背景', '二、研究方法', '三、结论'],
);
assert.match(chineseSections[1].excerpt, /丢失原文定位/);

assert.deepEqual(
  extractPaperSections('这是一段普通正文。\n它不应被识别为章节标题。'),
  [],
);

const sourceSummary = readFileSync(
  new URL('../src/components/library/SourceStructureSummary.tsx', import.meta.url),
  'utf8',
);
const libraryPanel = readFileSync(
  new URL('../src/components/library/LibraryPanel.tsx', import.meta.url),
  'utf8',
);
assert.match(sourceSummary, /data-testid="library-source-metadata"/);
assert.match(sourceSummary, /data-testid="library-source-sections"/);
assert.match(sourceSummary, /论文元数据/);
assert.match(sourceSummary, /章节结构/);
assert.match(libraryPanel, /<SourceStructureSummary/);

console.log(JSON.stringify({
  ok: true,
  checked: [
    'English numbered heading recognition',
    'Chinese numbered heading recognition',
    'section level and excerpt preservation',
    'ordinary paragraph rejection',
    'source detail metadata and section rendering contract',
  ],
}, null, 2));
