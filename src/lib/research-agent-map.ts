import type { NotebookDocument } from './private-notebook-document';
import { isKnowledgeMapDocument, type KnowledgeMapDocument } from './knowledge-map-document';

export interface KnowledgeMapGenerationInput { question: string; deepExtract: boolean }
export function isKnowledgeMapInput(value: unknown): value is KnowledgeMapGenerationInput {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<KnowledgeMapGenerationInput>;
  return Object.keys(v).length === 2 && typeof v.question === 'string' && Boolean(v.question.trim()) && v.question.length <= 1200 && typeof v.deepExtract === 'boolean';
}
export class KnowledgeMapSaveError extends Error {
  constructor(message: string, readonly data: KnowledgeMapDocument, readonly expectedRevision: string | null) { super(message); }
}
export function isGeneratedKnowledgeMap(value: unknown, runId: string, input: KnowledgeMapGenerationInput): value is KnowledgeMapDocument {
  return isKnowledgeMapDocument(value) && Boolean(value.session && typeof value.session.retrieval?.mode === 'string'
    && ['none', 'pass', 'missing-markers', 'invalid-markers'].includes(value.session.citationAudit?.status))
    && value.generation?.runId === runId && value.generation.question === input.question && value.generation.deepExtract === input.deepExtract;
}
export async function readGeneratedKnowledgeMap(response: Response, runId: string, input: KnowledgeMapGenerationInput, expectedRevision: string | null, signal: AbortSignal): Promise<NotebookDocument<KnowledgeMapDocument>> {
  signal.throwIfAborted();
  const payload = await response.json() as { document?: NotebookDocument<KnowledgeMapDocument>; unsavedDocument?: unknown; error?: string };
  signal.throwIfAborted();
  const saved = payload.document;
  if (response.ok && saved && /^[a-f0-9]{64}$/.test(saved.revision) && isGeneratedKnowledgeMap(saved.data, runId, input)) return saved;
  if (isGeneratedKnowledgeMap(payload.unsavedDocument, runId, input)) throw new KnowledgeMapSaveError(payload.error || '研究脉络已生成但尚未保存，可重试保存。', payload.unsavedDocument, expectedRevision);
  throw new Error(payload.error || '本轮研究脉络尚未确认保存，请重试读取。');
}
