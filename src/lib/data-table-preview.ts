import type { Paper } from '@/types';

export interface DataColumnSummary {
  name: string;
  type: 'numeric' | 'text' | 'mixed';
  missingCount: number;
  nonEmptyCount: number;
  numericCount: number;
  min?: number;
  max?: number;
  mean?: number;
}

export interface DataTablePreview {
  sheetName?: string;
  rowCount: number;
  sampledRowCount: number;
  columnCount: number;
  columns: DataColumnSummary[];
  resultsDraftHint: string;
}

const MAX_SAMPLE_ROWS = 200;
const MAX_COLUMNS = 12;
const XLSX_SHEET_HEADER = /^===\s*工作表:\s*(.+?)\s*===$/;

function normalizeCell(value?: string): string {
  return (value || '').trim();
}

function splitLines(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0);
}

function detectDelimiter(lines: string[]): string {
  const candidates = [',', '\t', ';'];
  const sample = lines.slice(0, 8);
  let best = ',';
  let bestScore = -1;

  for (const delimiter of candidates) {
    const counts = sample.map(line => countDelimiterOutsideQuotes(line, delimiter));
    const useful = counts.filter(count => count > 0);
    if (useful.length === 0) continue;
    const score = useful.reduce((sum, count) => sum + count, 0) - new Set(useful).size;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }

  return best;
}

function countDelimiterOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && char === delimiter) {
      count += 1;
    }
  }

  return count;
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && char === delimiter) {
      cells.push(normalizeCell(current));
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(normalizeCell(current));
  return cells;
}

function extractFirstSheet(text: string): { sheetName?: string; tableText: string } {
  const lines = splitLines(text);
  const firstSheetIndex = lines.findIndex(line => XLSX_SHEET_HEADER.test(line.trim()));
  if (firstSheetIndex < 0) return { tableText: lines.join('\n') };

  const sheetName = lines[firstSheetIndex].trim().match(XLSX_SHEET_HEADER)?.[1];
  const nextSheetIndex = lines.findIndex((line, index) => (
    index > firstSheetIndex && XLSX_SHEET_HEADER.test(line.trim())
  ));
  const sheetLines = lines.slice(
    firstSheetIndex + 1,
    nextSheetIndex > firstSheetIndex ? nextSheetIndex : undefined,
  );

  return { sheetName, tableText: sheetLines.join('\n') };
}

function parseNumber(value: string): number | null {
  const normalized = value
    .replace(/,/g, '')
    .replace(/%$/, '')
    .trim();
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function buildColumnSummary(name: string, values: string[], rowCount: number): DataColumnSummary {
  const numericValues: number[] = [];
  let nonEmptyCount = 0;

  for (const value of values) {
    const normalized = normalizeCell(value);
    if (!normalized) continue;
    nonEmptyCount += 1;
    const number = parseNumber(normalized);
    if (number !== null) numericValues.push(number);
  }

  const numericCount = numericValues.length;
  const type = numericCount === 0
    ? 'text'
    : numericCount === nonEmptyCount
      ? 'numeric'
      : 'mixed';

  return {
    name,
    type,
    missingCount: Math.max(0, rowCount - nonEmptyCount),
    nonEmptyCount,
    numericCount,
    min: numericValues.length ? Math.min(...numericValues) : undefined,
    max: numericValues.length ? Math.max(...numericValues) : undefined,
    mean: numericValues.length
      ? numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length
      : undefined,
  };
}

function makeResultsDraftHint(preview: Omit<DataTablePreview, 'resultsDraftHint'>): string {
  const numericColumns = preview.columns
    .filter(column => column.type === 'numeric')
    .map(column => column.name)
    .slice(0, 3);
  const missingColumns = preview.columns
    .filter(column => column.missingCount > 0)
    .map(column => column.name)
    .slice(0, 3);

  const numericText = numericColumns.length
    ? `优先报告 ${numericColumns.join('、')} 的范围、均值或分组差异。`
    : '当前样本未识别到稳定数值列，建议先确认变量含义。';
  const missingText = missingColumns.length
    ? `写作时需说明 ${missingColumns.join('、')} 等列存在缺失值。`
    : '暂未在采样范围内发现明显缺失值。';

  return `Results 初稿线索：该数据表包含 ${preview.rowCount} 行、${preview.columnCount} 列。${numericText}${missingText}`;
}

export function buildDataTablePreviewFromText(text: string): DataTablePreview | null {
  const { sheetName, tableText } = extractFirstSheet(text);
  const lines = splitLines(tableText);
  if (lines.length < 2) return null;

  const delimiter = detectDelimiter(lines);
  const parsedRows = lines
    .map(line => parseDelimitedLine(line, delimiter))
    .filter(row => row.some(cell => cell.trim().length > 0));
  if (parsedRows.length < 2) return null;

  const headers = parsedRows[0]
    .slice(0, MAX_COLUMNS)
    .map((header, index) => header || `列 ${index + 1}`);
  if (headers.length < 2) return null;

  const rows = parsedRows.slice(1).filter(row => row.some(cell => cell.trim().length > 0));
  if (rows.length === 0) return null;

  const sampledRows = rows.slice(0, MAX_SAMPLE_ROWS);
  const columns = headers.map((header, columnIndex) => buildColumnSummary(
    header,
    sampledRows.map(row => row[columnIndex] || ''),
    sampledRows.length,
  ));

  const previewBase = {
    sheetName,
    rowCount: rows.length,
    sampledRowCount: sampledRows.length,
    columnCount: parsedRows[0].length,
    columns,
  };

  return {
    ...previewBase,
    resultsDraftHint: makeResultsDraftHint(previewBase),
  };
}

export function buildDataTablePreviewForPaper(paper: Paper): DataTablePreview | null {
  if (paper.fileType !== 'csv' && paper.fileType !== 'xlsx') return null;
  const text = [paper.rawContent, paper.content, paper.abstract].filter(Boolean).join('\n');
  if (!text.trim()) return null;
  return buildDataTablePreviewFromText(text);
}
