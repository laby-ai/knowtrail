import assert from 'node:assert/strict';
import { buildDataTablePreviewForPaper, buildDataTablePreviewFromText } from '../src/lib/data-table-preview';
import type { Paper } from '../src/types';

const csvPreview = buildDataTablePreviewFromText([
  'group,score,age,note',
  'control,12,31,baseline',
  'control,15,29,',
  'treatment,20,34,improved',
  'treatment,22,,improved',
].join('\n'));

assert.ok(csvPreview, 'CSV preview should be generated');
assert.equal(csvPreview.rowCount, 4);
assert.equal(csvPreview.columnCount, 4);
assert.equal(csvPreview.columns.find(column => column.name === 'score')?.type, 'numeric');
assert.equal(csvPreview.columns.find(column => column.name === 'score')?.mean, 17.25);
assert.equal(csvPreview.columns.find(column => column.name === 'age')?.missingCount, 1);
assert.match(csvPreview.resultsDraftHint, /Results 初稿线索/);
assert.match(csvPreview.resultsDraftHint, /score/);

const xlsxPreview = buildDataTablePreviewFromText([
  '=== 工作表: Sheet1 ===',
  'subject\tvalue\tstatus',
  'A\t1\tok',
  'B\t3\tok',
  '=== 工作表: Sheet2 ===',
  'ignored,ignored',
  'x,y',
].join('\n'));

assert.ok(xlsxPreview, 'XLSX extracted text preview should be generated');
assert.equal(xlsxPreview.sheetName, 'Sheet1');
assert.equal(xlsxPreview.rowCount, 2);
assert.equal(xlsxPreview.columns.find(column => column.name === 'value')?.max, 3);

const prosePreview = buildDataTablePreviewFromText('这是一段文献摘要，没有表格结构。');
assert.equal(prosePreview, null);

const duplicatedPaperPreview = buildDataTablePreviewForPaper({
  id: 'paper-csv',
  title: 'Duplicated CSV',
  authors: [],
  year: 2026,
  keywords: [],
  abstract: 'CSV source',
  content: 'group,score\ncontrol,12\ntreatment,20',
  rawContent: 'group,score\ncontrol,12\ntreatment,20',
  shortName: 'CSV',
  fileName: 'data.csv',
  fileType: 'csv',
  fileSize: 80,
  uploadTime: '2026-07-09T00:00:00.000Z',
} satisfies Paper);

assert.ok(duplicatedPaperPreview, 'paper preview should use the canonical rawContent instead of duplicating content fields');
assert.equal(duplicatedPaperPreview.rowCount, 2);
assert.equal(duplicatedPaperPreview.columns.find(column => column.name === 'score')?.mean, 16);

console.log(JSON.stringify({
  ok: true,
  csv: {
    rows: csvPreview.rowCount,
    columns: csvPreview.columnCount,
    numericColumns: csvPreview.columns.filter(column => column.type === 'numeric').map(column => column.name),
  },
  xlsx: {
    sheetName: xlsxPreview.sheetName,
    rows: xlsxPreview.rowCount,
  },
  duplicatedPaperRows: duplicatedPaperPreview.rowCount,
}, null, 2));
