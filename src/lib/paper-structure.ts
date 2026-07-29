export interface PaperSection {
  title: string;
  level: number;
  excerpt: string;
}

const COMMON_HEADINGS = new Set([
  '摘要',
  '关键词',
  '研究背景',
  '研究方法',
  '研究结果',
  '讨论',
  '结论',
  '参考文献',
  'abstract',
  'keywords',
  'introduction',
  'background',
  'methods',
  'methodology',
  'results',
  'discussion',
  'conclusion',
  'conclusions',
  'references',
]);

function headingLevel(line: string): number | null {
  const markdown = line.match(/^(#{1,6})\s+(.+)$/);
  if (markdown) return markdown[1].length;

  const decimal = line.match(/^(\d+(?:\.\d+)*)[.)、]?\s+(.+)$/);
  if (decimal) return decimal[1].split('.').length;

  if (/^[一二三四五六七八九十]+[、.．]\s*\S+/.test(line)) return 1;
  if (/^第[一二三四五六七八九十\d]+[章节部分]\s*\S*/.test(line)) return 1;
  return COMMON_HEADINGS.has(line.toLowerCase()) ? 1 : null;
}

function cleanHeading(line: string): string {
  return line.replace(/^#{1,6}\s+/, '').replace(/\s+/g, ' ').trim();
}

export function extractPaperSections(text?: string): PaperSection[] {
  if (!text?.trim()) return [];
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim());
  const sections: PaperSection[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || line.length > 100 || /^\[\d+\]/.test(line)) continue;
    const level = headingLevel(line);
    if (!level) continue;

    const excerptLines: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor];
      if (!candidate) continue;
      if (headingLevel(candidate)) break;
      excerptLines.push(candidate);
      if (excerptLines.join(' ').length >= 320) break;
    }
    const excerpt = excerptLines.join(' ').slice(0, 320).trim();
    sections.push({ title: cleanHeading(line), level, excerpt });
    if (sections.length >= 24) break;
  }

  return sections;
}
