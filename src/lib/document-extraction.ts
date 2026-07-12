import { readFile } from 'node:fs/promises';

export function isImageDocumentType(ext: string): boolean {
  return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
}

async function extractPdfText(filePath: string): Promise<string> {
  try {
    process.env.PDF_PARSER_DISABLE_TEST = '1';
    const pdfParse = (await import('pdf-parse-fixed')).default;
    const result = await pdfParse(await readFile(filePath));
    return result.text || '';
  } catch (error) {
    console.error('[extractPdfText] Failed:', error instanceof Error ? error.message : 'unknown');
    return '';
  }
}

async function extractDocxText(filePath: string): Promise<string> {
  const mammoth = await import('mammoth');
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    if (result.value?.trim()) return result.value;
  } catch (error) {
    console.error('[extractDocxText] extractRawText failed:', error instanceof Error ? error.message : 'unknown');
  }

  try {
    const result = await mammoth.convertToHtml({ path: filePath });
    if (result.value?.trim()) {
      return result.value
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
    }
  } catch (error) {
    console.error('[extractDocxText] convertToHtml failed:', error instanceof Error ? error.message : 'unknown');
  }

  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await readFile(filePath));
    const documentXml = zip.file('word/document.xml');
    if (documentXml) {
      const xml = await documentXml.async('string');
      return (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
        .map(value => value.replace(/<[^>]+>/g, ''))
        .join('');
    }
  } catch (error) {
    console.error('[extractDocxText] JSZip fallback failed:', error instanceof Error ? error.message : 'unknown');
  }
  return '';
}

async function extractXlsxText(filePath: string): Promise<string> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.readFile(filePath);
  return workbook.SheetNames.map(sheetName => {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
    return csv.trim() ? `=== 工作表: ${sheetName} ===\n${csv}` : '';
  }).filter(Boolean).join('\n\n');
}

async function extractPptxText(filePath: string): Promise<string> {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await readFile(filePath));
    const slides: string[] = [];
    for (let index = 1; ; index += 1) {
      const slide = zip.file(`ppt/slides/slide${index}.xml`);
      if (!slide) break;
      const xml = await slide.async('string');
      const text = (xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [])
        .map(value => value.replace(/<a:t[^>]*>/, '').replace(/<\/a:t>/, ''))
        .filter(value => value.trim());
      if (text.length) slides.push(`=== 幻灯片 ${index} ===\n${text.join('\n')}`);
    }
    return slides.join('\n\n');
  } catch {
    return '';
  }
}

export async function extractDocumentContent(filePath: string, ext: string): Promise<string> {
  try {
    if (isImageDocumentType(ext)) {
      const mime = ext === 'jpg' ? 'jpeg' : ext;
      return `data:image/${mime};base64,${(await readFile(filePath)).toString('base64')}`;
    }
    if (['txt', 'md', 'csv'].includes(ext)) return readFile(filePath, 'utf-8');
    if (ext === 'pdf') return extractPdfText(filePath);
    if (ext === 'docx') return extractDocxText(filePath);
    if (ext === 'doc') {
      try { return await readFile(filePath, 'utf-8'); } catch { return '[DOC旧格式文件，建议转换为DOCX后上传]'; }
    }
    if (ext === 'xlsx') return extractXlsxText(filePath);
    if (ext === 'pptx') return extractPptxText(filePath);
    if (ext === 'ppt') return '[PPT旧格式文件，建议转换为PPTX后上传]';
    return '';
  } catch (error) {
    console.error(`[ReadFile] Failed to extract ${ext}:`, error instanceof Error ? error.message : 'unknown');
    return '';
  }
}
