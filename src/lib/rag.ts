export interface RagSourceInput {
  literature?: { evidenceScope: 'metadata' | 'abstract' | 'fulltext' };
  id?: string;
  title?: string;
  authors?: string[];
  year?: number;
  abstract?: string;
  content?: string;
  rawContent?: string;
  shortName?: string;
  fileName?: string;
  fileType?: string;
  keywords?: string[];
}

export interface SourceChunk {
  id: string;
  sourceId: string;
  sourceIndex: number;
  chunkIndex: number;
  paperShortName: string;
  sourceTitle: string;
  text: string;
  tokenEstimate: number;
  page?: number;
}

export interface GroundedCitation {
  paperId: string;
  paperShortName: string;
  excerpt: string;
  sourceId: string;
  chunkId: string;
  sourceTitle: string;
  score: number;
  chunkIndex: number;
  page?: number;
}

export interface GroundedContext {
  chunks: SourceChunk[];
  citations: GroundedCitation[];
  promptContext: string;
}

const DEFAULT_CHUNK_CHARS = 1200;
const DEFAULT_OVERLAP_CHARS = 180;
const DEFAULT_TOP_K = 6;
const MAX_CONTEXT_CHARS = 9000;

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2.6);
}

function sourceIdFor(source: RagSourceInput, sourceIndex: number): string {
  return source.id || source.fileName || source.title || `source-${sourceIndex + 1}`;
}

function sourceShortName(source: RagSourceInput): string {
  if (source.shortName?.trim()) return source.shortName.trim();
  const firstAuthor = source.authors?.[0] || '未知作者';
  return `${firstAuthor}. ${source.year || '?'}`;
}

function sourceTitle(source: RagSourceInput): string {
  return source.title || source.fileName || '未命名资料';
}

function sourceText(source: RagSourceInput): string {
  if (source.literature?.evidenceScope === 'metadata') return '';
  if (source.literature?.evidenceScope === 'abstract') {
    if (!source.abstract?.trim()) return '';
    return normalizeText(`证据范围：仅摘要，未获取全文。\n\n摘要：${source.abstract}`);
  }
  return normalizeText([
    source.title ? `标题：${source.title}` : '',
    source.abstract ? `摘要：${source.abstract}` : '',
    source.content ? `结构化总结：${source.content}` : '',
    source.rawContent ? `原始内容：${source.rawContent}` : '',
  ].filter(Boolean).join('\n\n'));
}

function inferPage(text: string): number | undefined {
  const match = text.match(/(?:第\s*|page\s*|p\.\s*|幻灯片\s*)(\d{1,4})/i);
  return match ? Number(match[1]) : undefined;
}

function splitIntoChunks(text: string, maxChars = DEFAULT_CHUNK_CHARS, overlapChars = DEFAULT_OVERLAP_CHARS): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
      continue;
    }

    if (current.length + paragraph.length + 2 <= maxChars) {
      current = `${current}\n\n${paragraph}`;
      continue;
    }

    chunks.push(current);
    const overlap = current.slice(Math.max(0, current.length - overlapChars));
    current = `${overlap}\n\n${paragraph}`.trim();

    while (current.length > maxChars * 1.35) {
      chunks.push(current.slice(0, maxChars));
      current = current.slice(Math.max(maxChars - overlapChars, 1)).trim();
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export function buildSourceChunks(sources: RagSourceInput[]): SourceChunk[] {
  return sources.flatMap((source, sourceIndex) => {
    const text = sourceText(source);
    const sourceId = sourceIdFor(source, sourceIndex);
    const title = source.literature?.evidenceScope === 'abstract'
      ? `${sourceTitle(source)}（仅摘要）`
      : sourceTitle(source);
    const shortName = sourceShortName(source);

    return splitIntoChunks(text).map((chunkText, chunkIndex) => ({
      id: `${sourceId}::chunk-${chunkIndex + 1}`,
      sourceId,
      sourceIndex,
      chunkIndex,
      paperShortName: shortName,
      sourceTitle: title,
      text: chunkText,
      tokenEstimate: estimateTokens(chunkText),
      page: inferPage(chunkText),
    }));
  });
}

function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const words = normalized.match(/[a-z0-9][a-z0-9_-]{1,}|[\u4e00-\u9fff]/g) || [];
  const cjk = words.filter(token => /^[\u4e00-\u9fff]$/.test(token));
  const bigrams: string[] = [];
  for (let i = 0; i < cjk.length - 1; i += 1) {
    bigrams.push(`${cjk[i]}${cjk[i + 1]}`);
  }
  return [...words.filter(token => token.length > 1 || /^[\u4e00-\u9fff]$/.test(token)), ...bigrams];
}

function termFrequency(tokens: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const token of tokens) {
    map.set(token, (map.get(token) || 0) + 1);
  }
  return map;
}

function scoreChunk(questionTerms: Map<string, number>, chunk: SourceChunk): number {
  const chunkTerms = termFrequency(tokenize(`${chunk.sourceTitle}\n${chunk.paperShortName}\n${chunk.text}`));
  let score = 0;
  for (const [term, queryCount] of questionTerms.entries()) {
    const hitCount = chunkTerms.get(term) || 0;
    if (hitCount > 0) score += (1 + Math.log(hitCount)) * queryCount;
  }
  return Number(score.toFixed(4));
}

function makeSnippet(text: string, questionTerms: string[], maxLength = 220): string {
  const normalized = normalizeText(text).replace(/\n+/g, ' ');
  const lower = normalized.toLowerCase();
  const hit = questionTerms.find(term => lower.includes(term.toLowerCase()));
  if (!hit) return normalized.slice(0, maxLength);

  const index = Math.max(0, lower.indexOf(hit.toLowerCase()));
  const start = Math.max(0, index - Math.floor(maxLength / 3));
  return normalized.slice(start, start + maxLength);
}

export function retrieveRelevantChunks(question: string, chunks: SourceChunk[], topK = DEFAULT_TOP_K): GroundedCitation[] {
  const questionTokens = tokenize(question);
  const questionTerms = termFrequency(questionTokens);
  const scored = chunks
    .map(chunk => ({ chunk, score: scoreChunk(questionTerms, chunk) }))
    .sort((a, b) => b.score - a.score || a.chunk.sourceIndex - b.chunk.sourceIndex || a.chunk.chunkIndex - b.chunk.chunkIndex);

  const selected = scored.filter(item => item.score > 0).slice(0, topK);
  const fallback = selected.length > 0 ? selected : scored.slice(0, Math.min(topK, 3)).map(item => ({ ...item, score: 0.1 }));

  return fallback.map(({ chunk, score }) => ({
    paperId: chunk.sourceId,
    paperShortName: chunk.paperShortName,
    excerpt: makeSnippet(chunk.text, questionTokens),
    sourceId: chunk.sourceId,
    chunkId: chunk.id,
    sourceTitle: chunk.sourceTitle,
    score,
    chunkIndex: chunk.chunkIndex,
    page: chunk.page,
  }));
}

export function buildGroundedContext(question: string, sources: RagSourceInput[], topK = DEFAULT_TOP_K): GroundedContext {
  const chunks = buildSourceChunks(sources);
  const citations = retrieveRelevantChunks(question, chunks, topK);
  const selectedChunkIds = new Set(citations.map(citation => citation.chunkId));
  let usedChars = 0;

  const promptContext = chunks
    .filter(chunk => selectedChunkIds.has(chunk.id))
    .map((chunk, index) => {
      const body = chunk.text.slice(0, Math.max(0, MAX_CONTEXT_CHARS - usedChars));
      usedChars += body.length;
      const pageLabel = chunk.page ? `, 页码: ${chunk.page}` : '';
      return `[${index + 1}] ${chunk.paperShortName} - ${chunk.sourceTitle}${pageLabel}\nsourceId: ${chunk.sourceId}\nchunkId: ${chunk.id}\n摘录:\n${body}`;
    })
    .filter(Boolean)
    .join('\n\n---\n\n');

  return { chunks, citations, promptContext };
}
