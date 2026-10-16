import type { KnowledgeCardData } from '@/lib/knowledge-card-types';
import type { Citation, CitationAuditResult, RetrievalMetadata } from '@/types';

export interface LearningMaterials {
  cards: KnowledgeCardData[];
  citations: Citation[];
  retrieval: RetrievalMetadata | null;
  citationAudit: CitationAuditResult | null;
  cardIndex: number;
  quizIndex: number;
  answers: Record<string, number>;
}

export const emptyLearningMaterials = (): LearningMaterials => ({ cards: [], citations: [], retrieval: null, citationAudit: null, cardIndex: 0, quizIndex: 0, answers: {} });

export function learningCardExtra(extra: string): string {
  return extra.replace(/(?:sourceId|chunkId)\s*[:：]\s*[A-Za-z0-9_:-]+(?:\s*[,，]\s*)?/g, '').trim();
}

export function isLearningMaterials(value: unknown): value is LearningMaterials {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<LearningMaterials>;
  return Array.isArray(item.cards) && item.cards.length <= 50
    && item.cards.every(card => card && ['category', 'title', 'content', 'extra'].every(key => typeof card[key as keyof KnowledgeCardData] === 'string'))
    && Array.isArray(item.citations) && item.citations.length <= 100
    && item.citations.every(citation => citation && typeof citation.paperId === 'string' && typeof citation.paperShortName === 'string' && typeof citation.excerpt === 'string')
    && (item.retrieval === null || Boolean(item.retrieval && typeof item.retrieval === 'object' && typeof item.retrieval.mode === 'string'))
    && (item.citationAudit === null || Boolean(item.citationAudit && typeof item.citationAudit === 'object' && ['none', 'pass', 'missing-markers', 'invalid-markers'].includes(item.citationAudit.status) && Array.isArray(item.citationAudit.citedNumbers)))
    && Number.isInteger(item.cardIndex) && Number(item.cardIndex) >= 0 && Number(item.cardIndex) < Math.max(1, item.cards.length)
    && Number.isInteger(item.quizIndex) && Number(item.quizIndex) >= 0 && Number(item.quizIndex) < Math.max(1, Math.min(5, item.cards.length))
    && Boolean(item.answers && typeof item.answers === 'object' && !Array.isArray(item.answers))
    && Object.keys(item.answers || {}).length <= 5
    && Object.values(item.answers || {}).every(answer => Number.isInteger(answer) && answer >= 0 && answer <= 3);
}
