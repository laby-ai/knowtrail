import type { DiscoveredSource } from './discover-search-provider';

export type DiscoverRelevanceVerdict = 'relevant' | 'partially_relevant' | 'irrelevant' | 'unassessed';

export type DiscoverRelevanceStageStatus =
  | 'empty-search'
  | 'no-query-terms'
  | 'passed'
  | 'partially-relevant-only'
  | 'filtered-low-relevance'
  | 'all-irrelevant';

export interface DiscoveredSourceRelevance {
  verdict: DiscoverRelevanceVerdict;
  confidence: number;
  matchedTerms: string[];
  missingTerms: string[];
  reason: string;
}

export interface ScoredDiscoveredSource extends DiscoveredSource {
  relevance: DiscoveredSourceRelevance;
}

export interface DiscoverRelevanceStageSummary {
  status: DiscoverRelevanceStageStatus;
  reason: string;
  totalCount: number;
  acceptedCount: number;
  relevantCount: number;
  partiallyRelevantCount: number;
  irrelevantCount: number;
  queryTermCount: number;
}

export interface DiscoverRelevanceStageResult extends DiscoverRelevanceStageSummary {
  results: ScoredDiscoveredSource[];
}

const ENGLISH_STOP_TERMS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'for', 'how', 'in', 'is', 'of', 'on',
  'or', 'that', 'the', 'their', 'this', 'to', 'with', 'what', 'when', 'why',
]);

const CHINESE_FUNCTION_TERMS = new Set([
  '方法', '机制', '应用', '研究', '技术', '现状', '综述',
]);

const RELEVANT_THRESHOLD = 0.55;
const PARTIAL_THRESHOLD = 0.28;

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function isHan(value: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(value);
}

function extractBinaryTerms(segment: string): string[] {
  if (segment.length < 2) return [segment];
  return Array.from({ length: segment.length - 1 }, (_, index) => segment.slice(index, index + 2));
}

export function extractRelevanceQueryTerms(query: string): string[] {
  const normalized = normalizeText(query);
  const terms = new Set<string>();
  for (const token of normalized.split(/\s+/).filter(Boolean)) {
    if (isHan(token)) {
      for (const term of extractBinaryTerms(token)) {
        if (!CHINESE_FUNCTION_TERMS.has(term)) terms.add(term);
      }
      terms.add(token);
    } else if (token.length >= 2 && !ENGLISH_STOP_TERMS.has(token)) {
      terms.add(token);
    }
  }
  return [...terms];
}

function matchRate(terms: string[], text: string): { matched: string[]; ratio: number } {
  if (!terms.length) return { matched: [], ratio: 0 };
  const normalizedText = normalizeText(text);
  const matched = terms.filter(term => normalizedText.includes(term));
  return {
    matched,
    ratio: terms.length ? matched.length / terms.length : 0,
  };
}

function describeConfidence(verdict: DiscoverRelevanceVerdict, matches: string[], missing: string[]): string {
  const label = verdict === 'relevant'
    ? '核心查询主题对应'
    : verdict === 'partially_relevant'
      ? '部分查询内容对应'
      : '核心查询内容未对应';
  return matches.length
    ? `${label}: ${matches.join('、')}`
    : `${label}${missing.length ? `, 缺少 ${missing.join('、')}` : ''}`;
}

export function scoreDiscoveredSourceRelevance(
  query: string,
  source: DiscoveredSource,
  queryTerms: string[] = extractRelevanceQueryTerms(query),
): ScoredDiscoveredSource {
  if (queryTerms.length === 0) {
    return {
      ...source,
      relevance: {
        verdict: 'unassessed',
        confidence: 0,
        matchedTerms: [],
        missingTerms: [],
        reason: '无法提取查询主题词，请人工核验。',
      },
    };
  }
  const titleMatch = matchRate(queryTerms, source.title);
  const summaryParts = [source.snippet || '', source.content || ''];
  const summaryMatch = matchRate(queryTerms, summaryParts.join(' '));
  const matched = [...new Set([...titleMatch.matched, ...summaryMatch.matched])];
  const missing = queryTerms.filter(term => !matched.includes(term));
  const phrase = normalizeText(query);
  const fullPhraseMatch = phrase.length >= 4 && [
    normalizeText(source.title),
    normalizeText(summaryParts.join(' ')),
  ].some(text => text.includes(phrase));

  const score = titleMatch.ratio * 0.55
    + summaryMatch.ratio * 0.30
    + (titleMatch.matched.length > 0 ? 0.10 : 0)
    + (fullPhraseMatch ? 0.10 : 0);
  const confidence = Math.max(0, Math.min(1, score));
  const verdict: DiscoverRelevanceVerdict = confidence >= RELEVANT_THRESHOLD
    ? 'relevant'
    : confidence >= PARTIAL_THRESHOLD
      ? 'partially_relevant'
      : 'irrelevant';

  return {
    ...source,
    relevance: {
      verdict,
      confidence: Number(confidence.toFixed(3)),
      matchedTerms: matched,
      missingTerms: missing,
      reason: describeConfidence(verdict, matched, missing),
    },
  };
}

export function applyDiscoverRelevanceStage(
  query: string,
  sources: DiscoveredSource[],
): DiscoverRelevanceStageResult {
  const queryTerms = extractRelevanceQueryTerms(query);
  const scoredSources = sources.map(source => scoreDiscoveredSourceRelevance(query, source, queryTerms));
  const relevant = scoredSources.filter(source => source.relevance.verdict === 'relevant');
  const partial = scoredSources.filter(source => source.relevance.verdict === 'partially_relevant');
  const irrelevant = scoredSources.filter(source => source.relevance.verdict === 'irrelevant');
  const accepted = [...relevant, ...partial].sort((left, right) =>
    right.relevance.confidence - left.relevance.confidence
    || left.relevance.verdict.localeCompare(right.relevance.verdict),
  );

  const baseSummary = {
    totalCount: scoredSources.length,
    acceptedCount: accepted.length,
    relevantCount: relevant.length,
    partiallyRelevantCount: partial.length,
    irrelevantCount: irrelevant.length,
    queryTermCount: queryTerms.length,
  };

  if (sources.length === 0) {
    return {
      ...baseSummary,
      status: 'empty-search',
      reason: '搜索源未返回候选。',
      acceptedCount: 0,
      relevantCount: 0,
      partiallyRelevantCount: 0,
      irrelevantCount: 0,
      results: [],
    };
  }

  if (queryTerms.length === 0) {
    return {
      ...baseSummary,
      status: 'no-query-terms',
      reason: '无法提取查询主题词，已保留全部候选并要求人工核验。',
      acceptedCount: scoredSources.length,
      relevantCount: 0,
      partiallyRelevantCount: 0,
      irrelevantCount: 0,
      results: scoredSources,
    };
  }

  if (irrelevant.length === 0) {
    return {
      ...baseSummary,
      status: relevant.length > 0 ? 'passed' : 'partially-relevant-only',
      reason: relevant.length > 0
        ? `至少 ${relevant.length} 条候选直接对应查询主题词。`
        : '候选仅部分覆盖查询主题词，需人工核验后再入库。',
      results: accepted,
    };
  }

  if (accepted.length === 0) {
    return {
      ...baseSummary,
      status: 'all-irrelevant',
      reason: '所有候选均与查询主题词不相关。',
      results: [],
    };
  }

  return {
    ...baseSummary,
    status: 'filtered-low-relevance',
    reason: `已过滤 ${irrelevant.length} 条低相关候选。`,
    results: accepted,
  };
}
