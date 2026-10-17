import type { NotebookDocument } from './private-notebook-document';
import { isExperimentDocument, isHypothesisDocument, type ResearchDesignDocument, type ResearchDesignKind } from './research-design-document';

export interface ResearchDesignGenerationInput {
  kind: ResearchDesignKind;
  question: string;
  experiment?: { hypothesis: string; experimentalUnit: string; arms: string[]; primaryOutcome: string; constraints: string; alpha: number; targetPower: number };
}

export function isResearchDesignInput(value: unknown): value is ResearchDesignGenerationInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as Partial<ResearchDesignGenerationInput>;
  const text = (s: unknown) => typeof s === 'string' && Boolean(s.trim()) && s.length <= 1200;
  if (Object.keys(input).some(k => !['kind', 'question', 'experiment'].includes(k)) || !text(input.question)) return false;
  if (input.kind === 'hypothesis-generation') return input.experiment === undefined;
  const e = input.experiment;
  return input.kind === 'experiment-design' && Boolean(e && Object.keys(e).length === 7
    && ['hypothesis', 'experimentalUnit', 'primaryOutcome'].every(k => text(e[k as keyof typeof e]))
    && typeof e.constraints === 'string' && e.constraints.length <= 1200
    && Array.isArray(e.arms) && e.arms.length >= 2 && e.arms.length <= 8 && e.arms.every(text)
    && typeof e.alpha === 'number' && e.alpha > 0 && e.alpha < 1
    && typeof e.targetPower === 'number' && e.targetPower > 0 && e.targetPower < 1);
}

export function isResearchDesignDocument(value: unknown, kind: ResearchDesignKind): value is ResearchDesignDocument {
  return kind === 'hypothesis-generation' ? isHypothesisDocument(value) : isExperimentDocument(value);
}

export class ResearchDesignSaveError extends Error {
  constructor(message: string, readonly data: ResearchDesignDocument, public expectedRevision: string | null = null) { super(message); }
}

// Only a valid durable acknowledgement for this exact run can become a chat artifact.
export async function readGeneratedDesign(response: Response, kind: ResearchDesignKind, runId: string, signal: AbortSignal): Promise<NotebookDocument<ResearchDesignDocument>> {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || '生成未完成，请检查设计要素后重试。');
  }
  if (!response.body) throw new Error('生成服务没有返回内容。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let document: NotebookDocument<ResearchDesignDocument> | undefined;
  let error: string | undefined;
  let unsaved: ResearchDesignDocument | undefined;
  const accept = (frame: string) => {
    const raw = frame.split(/\r?\n/).filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
    if (!raw || raw === '[DONE]') return;
    const payload = JSON.parse(raw) as { document?: NotebookDocument<ResearchDesignDocument>; unsavedDocument?: unknown; error?: string; saveError?: string };
    if (payload.error || payload.saveError) error = payload.error || payload.saveError;
    const saved = payload.document;
    if (saved && /^[a-f0-9]{64}$/.test(saved.revision) && isResearchDesignDocument(saved.data, kind) && saved.data.result?.runId === runId) document = saved;
    if (isResearchDesignDocument(payload.unsavedDocument, kind) && payload.unsavedDocument.result?.runId === runId) unsaved = payload.unsavedDocument;
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop() || '';
      frames.forEach(accept);
    }
    buffer += decoder.decode(); if (buffer.trim()) accept(buffer);
  } finally {
    if (signal.aborted) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!document && unsaved) throw new ResearchDesignSaveError(error || '结果已生成但尚未保存，可重试保存。', unsaved);
  if (error || !document) throw new Error(error || '尚未确认保存，请重试读取。');
  return document;
}
