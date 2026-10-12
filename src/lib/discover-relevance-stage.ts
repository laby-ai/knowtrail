import { assessSearchTopics, queryTopics } from './search-topic-relevance';
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

export function extractRelevanceQueryTerms(query: string): string[] {
  return queryTopics(query).map(group => group.label);
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
  const groups = queryTopics(query);
  const summary = source.snippet || (source.content || '').slice(0, 6000);
  const titleMatch = assessSearchTopics(query, source.title, groups);
  const summaryMatch = assessSearchTopics(query, summary, groups);
  const assessment = assessSearchTopics(query, [source.title, summary, source.date].join(' '), groups);
  const matched = assessment.matched;
  const missing = assessment.missing;
  const confidence = Math.min(1, titleMatch.coverage * 0.55 + summaryMatch.coverage * 0.45);
  const verdict: DiscoverRelevanceVerdict = assessment.accepted ? 'relevant' : 'irrelevant';

  return {
    ...source,
    relevance: {
      verdict,
      confidence: Number(confidence.toFixed(3)),
      matchedTerms: matched,
      missingTerms: missing,
      reason: assessment.accepted ? `核心主题已覆盖：${matched.join('、')}` : `已排除：缺少核心主题 ${missing.join('、')}`, 
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
      reason: '查询包含特殊检索语法或缺少核心主题词，已保留搜索源结果，请人工核验。',
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
    reason: `已过滤 ${irrelevant.length} 条未覆盖核心主题的候选。`,
    results: accepted,
  };
}
