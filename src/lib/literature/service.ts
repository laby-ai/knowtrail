import { assessSearchTopics, queryTopics } from '../search-topic-relevance';
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

  const topics = queryTopics(query);

  const filtered = deduped.filter(paper => {
    const year = typeof paper.year === 'string' ? parseInt(paper.year, 10) : paper.year;
    if ((yearFrom || yearTo) && (!Number.isFinite(year) || year < 1900)) return false;
    if (yearFrom && year < yearFrom) return false;
    if (yearTo && year > yearTo) return false;
    const identifier = query.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '');
    if (/^10\.\d{4,9}\/\S+$/.test(identifier)) return paper.doi?.toLowerCase() === identifier;
    return assessSearchTopics(query, [paper.title, paper.abstract, ...paper.authors.map(author => author.name), paper.doi || '', paper.arxivId || '', Number.isFinite(year) && year > 0 ? String(year) : ''].join(' '), topics).accepted;
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
