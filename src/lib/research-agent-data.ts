import type { NotebookDocument } from './private-notebook-document';
import { isDataProcessingDocument, type DataProcessingDocument } from './data-processing-document';
import type { DataProcessingRequest } from './data-processing-plan';

export interface DataPlanInput extends DataProcessingRequest { sourceId: string }
export function isDataPlanInput(value: unknown): value is DataPlanInput {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<DataPlanInput>;
  return Object.keys(v).every(k => ['sourceId', 'question', 'sampleUnit', 'taskFamily', 'targetColumn', 'splitColumn'].includes(k))
    && typeof v.sourceId === 'string' && /^[\w.-]{1,180}$/.test(v.sourceId)
    && typeof v.question === 'string' && Boolean(v.question.trim()) && v.question.length <= 1200
    && typeof v.sampleUnit === 'string' && Boolean(v.sampleUnit.trim()) && v.sampleUnit.length <= 200
    && ['description', 'prediction', 'comparison', 'trend'].includes(v.taskFamily || '')
    && [v.targetColumn, v.splitColumn].every(c => c === undefined || typeof c === 'string' && c.length <= 200)
    && (v.taskFamily === 'description' || Boolean(v.targetColumn?.trim()))
    && (!['comparison', 'trend'].includes(v.taskFamily || '') || Boolean(v.splitColumn?.trim()));
}
export function isGeneratedDataPlan(value: unknown, runId: string, input: DataPlanInput): value is DataProcessingDocument {
  return isDataProcessingDocument(value) && Boolean(value.plan) && value.generation?.runId === runId
    && value.sourceId === input.sourceId && value.plan!.dataset.sourceId === input.sourceId
    && value.question === input.question && value.sampleUnit === input.sampleUnit && value.taskFamily === input.taskFamily
    && value.targetColumn === (input.targetColumn || '') && value.splitColumn === (input.splitColumn || '')
    && value.plan!.contract.scientificQuestion === input.question.trim() && value.plan!.contract.sampleUnit === input.sampleUnit.trim()
    && value.plan!.contract.taskFamily === input.taskFamily && (value.plan!.contract.targetColumn || '') === (input.targetColumn || '')
    && (value.plan!.contract.splitColumn || '') === (input.splitColumn || '');
}
export class DataPlanSaveError extends Error {
  constructor(message: string, readonly data: DataProcessingDocument, readonly expectedRevision: string | null) { super(message); }
}
export async function readGeneratedDataPlan(response: Response, runId: string, input: DataPlanInput, expectedRevision: string | null, signal: AbortSignal): Promise<NotebookDocument<DataProcessingDocument>> {
  signal.throwIfAborted();
  const payload = await response.json() as { document?: NotebookDocument<DataProcessingDocument>; unsavedDocument?: unknown; msg?: string };
  signal.throwIfAborted();
  const saved = payload.document;
  if (response.ok && saved && /^[a-f0-9]{64}$/.test(saved.revision) && isGeneratedDataPlan(saved.data, runId, input)) return saved;
  if (isGeneratedDataPlan(payload.unsavedDocument, runId, input)) throw new DataPlanSaveError(payload.msg || '本轮方案尚未保存，可重试保存。', payload.unsavedDocument, expectedRevision);
  throw new Error(payload.msg || '本轮方案尚未确认保存，请重试读取。');
}
