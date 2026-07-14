import { embedTexts, hasRuntimeEmbeddingProvider } from '@/lib/runtime-embeddings';
import { listReadySourceChunks } from '@/lib/ingestion-store';
import { buildGroundedContext, retrieveRelevantChunks, type GroundedCitation, type GroundedContext, type RagSourceInput, type SourceChunk } from '@/lib/rag';
import { querySourceChunks } from '@/lib/vector-store';
import type { RuntimeAIConfig } from '@/types';

const DEFAULT_TOP_K = 6;
const MAX_PROMPT_CONTEXT_CHARS = 9000;

export type RetrievalMode = 'persisted-vector' | 'persisted-keyword' | 'request-keyword' | 'empty';

export interface GroundedRetrievalContext extends GroundedContext {
  retrievalMode: RetrievalMode;
  persistedSourceCount: number;
  vectorIndexedSourceCount: number;
  degraded: boolean;
  reason?: string;
}

export interface GroundedRetrievalOptions {
  topK?: number;
  ownerMemberId?: string;
  notebookId?: string;
  embedder?: (texts: string[]) => Promise<number[][]>;
}

function sourceIdentity(source: RagSourceInput): string | undefined {
  return source.id || source.fileName || source.title;
}

function selectedSourceIds(sources: RagSourceInput[]): Set<string> {
  return new Set(sources.map(sourceIdentity).filter((value): value is string => Boolean(value)));
}

function toPromptContext(citations: GroundedCitation[]): string {
  let usedChars = 0;
  const parts: string[] = [];

  for (const [index, citation] of citations.entries()) {
    const remaining = MAX_PROMPT_CONTEXT_CHARS - usedChars;
    if (remaining <= 0) break;

    const excerpt = citation.excerpt.slice(0, remaining);
    usedChars += excerpt.length;
    const pageLabel = citation.page ? `, 页码: ${citation.page}` : '';
    parts.push(`[${index + 1}] ${citation.paperShortName} - ${citation.sourceTitle}${pageLabel}
sourceId: ${citation.sourceId}
chunkId: ${citation.chunkId}
score: ${citation.score ?? 0}
摘录:
${excerpt}`);
  }

  return parts.join('\n\n---\n\n');
}

function dedupeCitations(citations: GroundedCitation[], topK: number): GroundedCitation[] {
  const seen = new Set<string>();
  const deduped: GroundedCitation[] = [];
  for (const citation of citations) {
    const key = citation.chunkId || `${citation.sourceId}:${citation.chunkIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(citation);
    if (deduped.length >= topK) break;
  }
  return deduped;
}

function citationIdentity(citation: GroundedCitation): string {
  return citation.chunkId || `${citation.sourceId}:${citation.chunkIndex}`;
}

export function balanceSelectedSourceCitations(
  citations: GroundedCitation[],
  selectedIds: Iterable<string>,
  topK: number,
): GroundedCitation[] {
  if (topK <= 0) return [];

  const uniqueCitations = dedupeCitations(citations, citations.length);
  const selectedSourceIds = new Set(selectedIds);
  if (selectedSourceIds.size <= 1 || topK < selectedSourceIds.size) {
    return uniqueCitations.slice(0, topK);
  }

  const coveredSources = new Set<string>();
  const chosenCitationIds = new Set<string>();
  for (const citation of uniqueCitations) {
    if (!selectedSourceIds.has(citation.sourceId) || coveredSources.has(citation.sourceId)) continue;
    coveredSources.add(citation.sourceId);
    chosenCitationIds.add(citationIdentity(citation));
  }

  for (const citation of uniqueCitations) {
    if (chosenCitationIds.size >= topK) break;
    chosenCitationIds.add(citationIdentity(citation));
  }

  return uniqueCitations
    .filter(citation => chosenCitationIds.has(citationIdentity(citation)))
    .slice(0, topK);
}

function makeResult(
  chunks: SourceChunk[],
  citations: GroundedCitation[],
  retrievalMode: RetrievalMode,
  persistedSourceCount: number,
  vectorIndexedSourceCount: number,
  degraded: boolean,
  reason?: string,
): GroundedRetrievalContext {
  return {
    chunks,
    citations,
    promptContext: toPromptContext(citations),
    retrievalMode,
    persistedSourceCount,
    vectorIndexedSourceCount,
    degraded,
    reason,
  };
}

export function toRetrievalMetadata(grounded: GroundedRetrievalContext) {
  return {
    mode: grounded.retrievalMode,
    persistedSourceCount: grounded.persistedSourceCount,
    vectorIndexedSourceCount: grounded.vectorIndexedSourceCount,
    degraded: grounded.degraded,
    reason: grounded.reason,
  };
}

export async function buildGroundedRetrievalContext(
  question: string,
  requestSources: RagSourceInput[],
  aiConfig?: Partial<RuntimeAIConfig>,
  options: GroundedRetrievalOptions = {},
): Promise<GroundedRetrievalContext> {
  const topK = options.topK || DEFAULT_TOP_K;
  const identities = [...selectedSourceIds(requestSources)];
  let persistedChunks = await listReadySourceChunks({
    identities,
    ownerMemberId: options.ownerMemberId,
    notebookId: options.notebookId,
    query: question,
    topK: Math.max(topK * 20, topK),
  });
  if (persistedChunks.chunks.length === 0 && question.trim()) {
    persistedChunks = await listReadySourceChunks({ identities, ownerMemberId: options.ownerMemberId, notebookId: options.notebookId });
  }
  const scopedChunks = persistedChunks.chunks;

  if (persistedChunks.vectorIndexedSourceCount > 0 && (options.embedder || hasRuntimeEmbeddingProvider(aiConfig))) {
    try {
      const [queryEmbedding] = options.embedder
        ? await options.embedder([question])
        : await embedTexts([question], aiConfig);
      const allowedSourceIds = new Set(persistedChunks.sourceIds);
      const vectorCandidateLimit = Math.max(topK * 50, scopedChunks.length * 50, 250);
      const candidates = await querySourceChunks(queryEmbedding, { topK: vectorCandidateLimit });
      const citations = balanceSelectedSourceCitations(
        candidates.filter(candidate => allowedSourceIds.has(candidate.sourceId)),
        identities,
        topK,
      );

      if (citations.length > 0) {
        return makeResult(
          scopedChunks,
          citations,
          'persisted-vector',
          persistedChunks.persistedSourceCount,
          persistedChunks.vectorIndexedSourceCount,
          false,
          '已使用持久化向量索引检索资料片段。',
        );
      }
    } catch {
      // Vector retrieval should never break chat; persisted keyword retrieval remains the fallback.
    }
  }

  if (scopedChunks.length > 0) {
    const rankedCitations = retrieveRelevantChunks(question, scopedChunks, Math.max(topK * 50, scopedChunks.length));
    const citations = balanceSelectedSourceCitations(rankedCitations, identities, topK);
    if (citations.length > 0) {
      const reason = persistedChunks.vectorIndexedSourceCount > 0
        ? '向量索引未命中足够相关片段，已降级为持久化文本片段检索。'
        : '当前资料尚未完成向量索引或未配置向量模型，已使用持久化文本片段检索。';
      return makeResult(
        scopedChunks,
        citations,
        'persisted-keyword',
        persistedChunks.persistedSourceCount,
        persistedChunks.vectorIndexedSourceCount,
        true,
        reason,
      );
    }
  }

  const requestGrounded = buildGroundedContext(question, requestSources, Math.max(topK * 50, topK));
  const requestCitations = balanceSelectedSourceCitations(requestGrounded.citations, identities, topK);
  const requestFallback = requestCitations.length > 0;
  return {
    ...requestGrounded,
    citations: requestCitations,
    promptContext: toPromptContext(requestCitations),
    retrievalMode: requestFallback ? 'request-keyword' : 'empty',
    persistedSourceCount: persistedChunks.persistedSourceCount,
    vectorIndexedSourceCount: persistedChunks.vectorIndexedSourceCount,
    degraded: true,
    reason: requestFallback
      ? '未找到可用的持久化资料片段，已降级为当前请求携带的资料内容。'
      : '未找到可用资料片段，请先上传并等待资料摄取完成。',
  };
}
