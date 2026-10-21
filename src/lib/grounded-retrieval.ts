import { embedTexts } from '@/lib/ai-service';
import { listReadySourceChunks } from '@/lib/ingestion-store';
import { buildGroundedContext, retrieveRelevantChunks, type GroundedCitation, type GroundedContext, type RagSourceInput, type SourceChunk } from '@/lib/rag';
import { querySourceChunks } from '@/lib/vector-store';
import { hasRuntimeAIProvider } from '@/lib/runtime-ai-config';
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
  // Ranked hits; adjacent owned passages may be appended within the context budget.
  topK?: number;
  ownerMemberId?: string;
  notebookId?: string;
  signal?: AbortSignal;
  embedder?: (texts: string[], signal?: AbortSignal) => Promise<number[][]>;
}

function sourceIdentity(source: RagSourceInput): string | undefined {
  return source.id || source.fileName || source.title;
}

function selectedSourceIds(sources: RagSourceInput[]): Set<string> {
  return new Set(sources.map(sourceIdentity).filter((value): value is string => Boolean(value)));
}

function toPromptContext(citations: GroundedCitation[], chunks: SourceChunk[]): string {
  let usedChars = 0;
  const parts: string[] = [];
  const chunksById = new Map(chunks.map(chunk => [chunk.id, chunk]));

  for (const [index, citation] of citations.entries()) {
    const remaining = MAX_PROMPT_CONTEXT_CHARS - usedChars;
    if (remaining <= 0) break;

    const chunk = chunksById.get(citation.chunkId);
    const text = chunk?.sourceId === citation.sourceId ? chunk.text : citation.excerpt;
    const excerpt = text.slice(0, remaining);
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

function makeResult(
  chunks: SourceChunk[],
  citations: GroundedCitation[],
  retrievalMode: RetrievalMode,
  persistedSourceCount: number,
  vectorIndexedSourceCount: number,
  degraded: boolean,
  reason?: string,
): GroundedRetrievalContext {
  const expanded = [...citations];
  const seen = new Set(citations.map(citation => citation.chunkId));
  const anchorsBySource = new Map<string, SourceChunk[]>();
  for (const citation of citations) {
    const anchor = chunks.find(chunk => chunk.id === citation.chunkId && chunk.sourceId === citation.sourceId);
    if (!anchor) continue;
    const anchors = anchorsBySource.get(anchor.sourceId) || [];
    anchors.push(anchor);
    anchorsBySource.set(anchor.sourceId, anchors);
  }
  // Read continuations before preceding context, taking turns across hit sources.
  // Only original hits expand, so a nearby passage never starts an unbounded walk.
  for (const offset of [1, -1]) {
    for (let rank = 0; rank < citations.length; rank += 1) {
      for (const anchors of anchorsBySource.values()) {
        const anchor = anchors[rank];
        if (!anchor) continue;
        const adjacent = chunks.find(chunk => chunk.sourceId === anchor.sourceId && chunk.chunkIndex === anchor.chunkIndex + offset);
        if (!adjacent?.text.trim() || seen.has(adjacent.id)) continue;
        if (chunks.some(chunk => chunk.sourceId === adjacent.sourceId && seen.has(chunk.id) && chunk.text.includes(adjacent.text))) continue;
        const citation: GroundedCitation = {
          paperId: adjacent.sourceId, paperShortName: adjacent.paperShortName,
          excerpt: adjacent.text.slice(0, 320), sourceId: adjacent.sourceId,
          chunkId: adjacent.id, sourceTitle: adjacent.sourceTitle, score: 0,
          chunkIndex: adjacent.chunkIndex, page: adjacent.page,
        };
        if (toPromptContext([...expanded, citation], chunks).length > MAX_PROMPT_CONTEXT_CHARS) continue;
        expanded.push(citation);
        seen.add(adjacent.id);
      }
    }
  }
  return {
    chunks,
    citations: expanded,
    promptContext: toPromptContext(expanded, chunks),
    retrievalMode,
    persistedSourceCount,
    vectorIndexedSourceCount,
    degraded,
    reason: expanded.length > citations.length
      ? `${reason || ''} 已在本轮阅读预算内补入${expanded.length - citations.length}个相邻原文片段。`.trim()
      : reason,
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
  const signal = options.signal;
  signal?.throwIfAborted();
  const topK = options.topK || DEFAULT_TOP_K;
  const identities = [...selectedSourceIds(requestSources)];
  let persistedChunks = await listReadySourceChunks({
    identities,
    ownerMemberId: options.ownerMemberId,
    notebookId: options.notebookId,
    query: question,
    topK: Math.max(topK * 20, topK),
  });
  signal?.throwIfAborted();
  if (persistedChunks.chunks.length === 0 && question.trim()) {
    persistedChunks = await listReadySourceChunks({ identities, ownerMemberId: options.ownerMemberId, notebookId: options.notebookId });
    signal?.throwIfAborted();
  }
  const scopedChunks = persistedChunks.chunks;

  const vectorReady = options.embedder || hasRuntimeAIProvider(aiConfig)
    ? await listReadySourceChunks({ identities, ownerMemberId: options.ownerMemberId, notebookId: options.notebookId })
    : null;
  signal?.throwIfAborted();
  if (vectorReady && vectorReady.vectorIndexedSourceCount > 0) {
    try {
      const [queryEmbedding] = options.embedder
        ? await options.embedder([question], signal)
        : await embedTexts([question], aiConfig, signal);
      signal?.throwIfAborted();
      const allowedSourceIds = new Set(vectorReady.sourceIds);
      const currentChunks = new Map(vectorReady.chunks.map(chunk => [chunk.id, chunk]));
      const vectorCandidateLimit = Math.max(topK * 50, scopedChunks.length * 50, 250);
      const candidates = await querySourceChunks(queryEmbedding, { topK: vectorCandidateLimit });
      signal?.throwIfAborted();
      const citations = dedupeCitations(
        candidates.flatMap(candidate => {
          const chunk = currentChunks.get(candidate.chunkId);
          if (!allowedSourceIds.has(candidate.sourceId) || chunk?.sourceId !== candidate.sourceId) return [];
          return [{ ...candidate, paperId: chunk.sourceId, paperShortName: chunk.paperShortName,
            sourceTitle: chunk.sourceTitle, excerpt: chunk.text.slice(0, 320), chunkIndex: chunk.chunkIndex, page: chunk.page }];
        }),
        topK,
      );

      if (citations.length > 0) {
        return makeResult(
          vectorReady.chunks,
          citations,
          'persisted-vector',
          vectorReady.persistedSourceCount,
          vectorReady.vectorIndexedSourceCount,
          false,
          '已使用持久化向量索引检索资料片段。',
        );
      }
    } catch {
      signal?.throwIfAborted();
      // Vector retrieval should never break chat; persisted keyword retrieval remains the fallback.
    }
  }

  if (scopedChunks.length > 0) {
    const citations = retrieveRelevantChunks(question, scopedChunks, topK);
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

  const requestGrounded = buildGroundedContext(question, requestSources, topK);
  const requestFallback = requestGrounded.citations.length > 0;
  return {
    ...requestGrounded,
    retrievalMode: requestFallback ? 'request-keyword' : 'empty',
    persistedSourceCount: persistedChunks.persistedSourceCount,
    vectorIndexedSourceCount: persistedChunks.vectorIndexedSourceCount,
    degraded: true,
    reason: requestFallback
      ? '未找到可用的持久化资料片段，已降级为当前请求携带的资料内容。'
      : '未找到可用资料片段，请先上传并等待资料摄取完成。',
  };
}
