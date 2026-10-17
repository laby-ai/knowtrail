import { isLearningMaterials, type LearningMaterials } from './learning-materials';
import type { NotebookDocument } from './private-notebook-document';

export interface LearningInput { kind: 'knowledge-cards' | 'quiz'; question: string }
export function isLearningInput(value: unknown): value is LearningInput {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<LearningInput>;
  return Object.keys(v).every(k => ['kind', 'question'].includes(k)) && ['knowledge-cards', 'quiz'].includes(v.kind || '')
    && typeof v.question === 'string' && Boolean(v.question.trim()) && v.question.length <= 1200;
}
export function isGeneratedLearning(value: unknown, runId: string, input: LearningInput): value is LearningMaterials {
  return isLearningMaterials(value) && value.cards.length > 0 && value.citations.length > 0
    && value.generation?.runId === runId && value.generation.question === input.question && value.generation.kind === input.kind;
}
export class LearningSaveError extends Error {
  constructor(message: string, readonly data: LearningMaterials, readonly expectedRevision: string | null) { super(message); }
}
export async function readGeneratedLearning(response: Response, runId: string, input: LearningInput, expectedRevision: string | null, signal: AbortSignal): Promise<NotebookDocument<LearningMaterials>> {
  signal.throwIfAborted();
  const payload = await response.json() as { document?: NotebookDocument<LearningMaterials>; unsavedDocument?: unknown; error?: string };
  signal.throwIfAborted();
  if (response.ok && payload.document && /^[a-f0-9]{64}$/.test(payload.document.revision) && isGeneratedLearning(payload.document.data, runId, input)) return payload.document;
  if (isGeneratedLearning(payload.unsavedDocument, runId, input)) throw new LearningSaveError(payload.error || '材料尚未保存，可重试保存。', payload.unsavedDocument, expectedRevision);
  throw new Error(payload.error || '本轮学习材料尚未确认保存，请重试。');
}
