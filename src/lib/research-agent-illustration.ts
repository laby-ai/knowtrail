import { isIllustrationDocument, type IllustrationDocument } from './scientific-illustration-document';
import type { ScientificIllustrationRequest } from './scientific-illustration-contract';
import type { NotebookDocument } from './private-notebook-document';

export type IllustrationInput = Pick<ScientificIllustrationRequest, 'purpose' | 'figureKind' | 'aspectRatio' | 'requiredLabels'>;
export function isIllustrationInput(value: unknown): value is IllustrationInput {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<IllustrationInput>;
  return Object.keys(v).every(k => ['purpose', 'figureKind', 'aspectRatio', 'requiredLabels'].includes(k))
    && typeof v.purpose === 'string' && v.purpose.trim().length >= 8 && v.purpose.length <= 1200
    && ['workflow', 'conceptual-framework', 'method-diagram', 'mechanism-schematic'].includes(v.figureKind || '')
    && ['1:1', '4:3', '16:9'].includes(v.aspectRatio || '')
    && Array.isArray(v.requiredLabels) && v.requiredLabels.length <= 6
    && v.requiredLabels.every(s => typeof s === 'string' && s.trim().length > 0 && s.length <= 40 && s === s.trim());
}
export function isGeneratedIllustration(value: unknown, runId: string, input: IllustrationInput): value is IllustrationDocument & { result: NonNullable<IllustrationDocument['result']> } {
  return isIllustrationDocument(value) && Boolean(value.result) && value.runId === runId
    && value.form.purpose === input.purpose && value.form.figureKind === input.figureKind && value.form.aspectRatio === input.aspectRatio
    && value.form.requiredLabels === input.requiredLabels.join('、')
    && value.result!.purpose === input.purpose && value.result!.figureKind === input.figureKind && value.result!.aspectRatio === input.aspectRatio;
}
export class IllustrationSaveError extends Error {
  constructor(message: string, readonly data: IllustrationDocument, readonly expectedRevision: string | null) { super(message); }
}
export async function readGeneratedIllustration(response: Response, runId: string, input: IllustrationInput, expectedRevision: string | null, signal: AbortSignal): Promise<NotebookDocument<IllustrationDocument & { result: NonNullable<IllustrationDocument['result']> }>> {
  signal.throwIfAborted();
  const payload = await response.json() as { document?: NotebookDocument<unknown>; unsavedDocument?: unknown; error?: string; saveError?: string };
  signal.throwIfAborted();
  const saved = payload.document;
  if (response.ok && saved && /^[a-f0-9]{64}$/.test(saved.revision) && isGeneratedIllustration(saved.data, runId, input)) return { ...saved, data: saved.data };
  if (isGeneratedIllustration(payload.unsavedDocument, runId, input)) throw new IllustrationSaveError(payload.saveError || '图片已生成但尚未保存，可重试保存。', payload.unsavedDocument, expectedRevision);
  throw new Error(payload.error || '本轮示意图尚未确认保存，请重试读取。');
}
