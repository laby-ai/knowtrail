import assert from 'node:assert/strict';
import { buildDataTablePreviewFromText } from '../src/lib/data-table-preview';

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
}, null, 2));
