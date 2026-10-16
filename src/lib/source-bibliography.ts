interface SourceBibliographyInput {
  authors?: unknown;
  year?: unknown;
  rawContent?: string;
  chunks?: Array<{ text?: string }>;
}

export function sourceBibliography(source: SourceBibliographyInput): { authors: string[]; year?: number } {
  // Legacy records kept the source text but omitted bibliographic fields.
  // Recover only explicitly labelled headers, never dates mentioned in the body.
  const header = (source.rawContent || source.chunks?.map(chunk => chunk.text || '').join('\n') || '').slice(0, 3000);
  const authorHeader = header.match(/^(?:作者|Authors?)[ \t]*[:：][ \t]*([^\r\n]+)/im)?.[1];
  const candidates = Array.isArray(source.authors) && source.authors.length
    ? source.authors
    : authorHeader?.split(/[,，、;；]/) || [];
  const authors = candidates.filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(value => value && !/^(?:未解析作者|未知作者|作者未知|已入库来源|unknown(?: author)?|n\/a|无)$/i.test(value));
  const explicitYear = header.match(/^(?:年份|发表年份|出版年|Year|Publication year)[ \t]*[:：][ \t]*(\d{4})[ \t]*$/im)?.[1];
  const year = typeof source.year === 'number' ? source.year : explicitYear ? Number(explicitYear) : undefined;
  return { authors, ...(year !== undefined && Number.isInteger(year) && year >= 1000 && year <= 9999 ? { year } : {}) };
}
