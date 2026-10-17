import type { KnowledgeMapResponse } from '@/lib/knowledge-map-types';

export interface KnowledgeMapSession extends KnowledgeMapResponse {
  sourceCount: number;
  cache: { hit: boolean; storedAt?: string } | null;
}
export interface KnowledgeMapDocument {
  session: KnowledgeMapSession | null;
  generation?: { runId: string; question: string; deepExtract: boolean };
}
export const emptyKnowledgeMap = (): KnowledgeMapDocument => ({ session: null });

export function isKnowledgeMapDocument(value: unknown): value is KnowledgeMapDocument {
  if (!value || typeof value !== 'object' || !('session' in value)) return false;
  if ('generation' in value && value.generation !== undefined) {
    const g = value.generation as KnowledgeMapDocument['generation'];
    if (!g || !/^[a-f0-9-]{36}$/i.test(g.runId) || typeof g.question !== 'string' || !g.question.trim() || g.question.length > 1200 || typeof g.deepExtract !== 'boolean') return false;
  }
  const session = value.session;
  if (session === null) return true;
  if (!session || typeof session !== 'object') return false;
  const candidate = session as Partial<KnowledgeMapSession>;
  return Number.isInteger(candidate.sourceCount) && Number(candidate.sourceCount) > 0 &&
    Array.isArray(candidate.citations) && candidate.citations.every(c => typeof c.paperId === 'string' && typeof c.excerpt === 'string') &&
    Boolean(candidate.map && typeof candidate.map.title === 'string' && Array.isArray(candidate.map.nodes) && candidate.map.nodes.length > 0 &&
      candidate.map.nodes.every(n => typeof n.id === 'string' && typeof n.label === 'string' && typeof n.summary === 'string' && Array.isArray(n.citationNumbers)) &&
      Array.isArray(candidate.map.edges) && candidate.map.edges.length > 0 && candidate.map.edges.every(e => typeof e.source === 'string' && typeof e.target === 'string' && typeof e.relation === 'string') &&
      candidate.map.analysis && Array.isArray(candidate.map.analysis.hubNodes) && Array.isArray(candidate.map.analysis.bridgeEdges) && Array.isArray(candidate.map.analysis.suggestedQuestions) &&
      Array.isArray(candidate.map.communities));
}
