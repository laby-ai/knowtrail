import { searchLiterature, SOURCE_DISPLAY_NAMES } from './providers';
import { deduplicateResults, getAlsoFoundIn } from './dedupe';
import { signLiteratureResult } from './result-token';
import { checkRateLimit, withConcurrencyLimit } from './request';
import type { LiteraturePaper, LiteratureProviderId, LiteratureResult } from './types';
import { LITERATURE_PROVIDER_IDS } from './types';

export interface SearchOptions {
  query: string;
  sources?: LiteratureProviderId[];
  limitPerSource?: number;
  userId?: string;
  yearFrom?: number;
  yearTo?: number;
}

function extractKeywords(query: string): string[] {
  const stopwords = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their', 'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how', 'not', 'no', 'nor', 'but', 'if', 'then', 'else', 'so', 'such', 'too', 'very', 'just', 'about', 'above', 'after', 'again', 'all', 'also', 'am', 'any', 'because', 'before', 'between', 'both', 'during', 'each', 'few', 'further', 'get', 'got', 'here', 'into', 'more', 'most', 'myself', 'once', 'only', 'other', 'others', 'out', 'over', 'own', 'same', 'some', 'still', 'there', 'through', 'under', 'up', 'while']);
  return query
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopwords.has(w));
}

function calculateRelevanceScore(paper: LiteraturePaper, keywords: string[]): number {
  if (keywords.length === 0) return 1;
  const title = (paper.title || '').toLowerCase();
  const abstract = (paper.abstract || '').toLowerCase();
  const venue = (paper.venue || '').toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (title.includes(kw)) score += 3;
    if (abstract.includes(kw)) score += 1;
    if (venue.includes(kw)) score += 2;
  }
  return score / keywords.length;
}

export async function searchAllSources(options: SearchOptions): Promise<LiteratureResult[]> {
  const { query, sources = [...LITERATURE_PROVIDER_IDS], limitPerSource = 10, userId = 'anonymous', yearFrom, yearTo } = options;

  const rateCheck = checkRateLimit(userId);
  if (!rateCheck.allowed) {
    throw new Error(`请求频率超限，请 ${rateCheck.retryAfter} 秒后重试`);
  }

  const allPapers: LiteraturePaper[] = [];

  const tasks = sources.map(source =>
    withConcurrencyLimit(async () => {
      try {
        return await searchLiterature(source, query, limitPerSource);
      } catch (err) {
        console.error(`[${source}] search failed:`, err instanceof Error ? err.message : 'unknown');
        return [];
      }
    })
  );

  const results = await Promise.all(tasks);
  for (const batch of results) {
    allPapers.push(...batch);
  }

  const deduped = deduplicateResults(allPapers.map(paper => ({
    ...paper,
    authors: paper.authors.map(author => ({ name: author.name.trim() })).filter(author => author.name),
  })));

  const keywords = extractKeywords(query);

  const filtered = deduped.filter(paper => {
    const year = typeof paper.year === 'string' ? parseInt(paper.year, 10) : paper.year;
    if (yearFrom && year < yearFrom) return false;
    if (yearTo && year > yearTo) return false;
    const score = calculateRelevanceScore(paper, keywords);
    if (score < 1) return false;
    return true;
  });

  return filtered.map(paper => {
    const resultId = signLiteratureResult(paper);
    const alsoFoundIn = getAlsoFoundIn(paper, allPapers);
    return {
      ...paper,
      resultId,
      retrievedAt: new Date().toISOString(),
      alsoFoundIn,
    };
  });
}

export { SOURCE_DISPLAY_NAMES };
