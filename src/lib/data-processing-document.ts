import type { DataProcessingPlan, DataProcessingRequest } from '@/lib/data-processing-plan';

export interface DataProcessingDocument extends DataProcessingRequest {
  generation?: { runId: string };
  sourceId: string;
  targetColumn: string;
  splitColumn: string;
  plan: DataProcessingPlan | null;
}
export const emptyDataProcessing = (): DataProcessingDocument => ({ sourceId: '', question: '', sampleUnit: '', taskFamily: 'description', targetColumn: '', splitColumn: '', plan: null });

export function isDataProcessingDocument(value: unknown): value is DataProcessingDocument {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<DataProcessingDocument>;
  if (data.generation !== undefined && (!data.generation || typeof data.generation.runId !== 'string' || !/^[a-f0-9-]{36}$/i.test(data.generation.runId))) return false;
  if (typeof data.sourceId !== 'string' || typeof data.question !== 'string' || data.question.length > 1200 || typeof data.sampleUnit !== 'string' || data.sampleUnit.length > 200 ||
    !['description', 'prediction', 'comparison', 'trend'].includes(data.taskFamily || '') || typeof data.targetColumn !== 'string' || typeof data.splitColumn !== 'string') return false;
  const plan = data.plan;
  return plan === null || Boolean(plan && plan.dataset && typeof plan.dataset.sourceId === 'string' && typeof plan.dataset.sourceTitle === 'string' && Number.isInteger(plan.dataset.rowCount) && Number.isInteger(plan.dataset.columnCount) &&
    Array.isArray(plan.dataset.columns) && plan.contract && typeof plan.contract.sampleUnit === 'string' && plan.recommendation && typeof plan.recommendation.baseline === 'string' && Array.isArray(plan.recommendation.metrics) &&
    plan.dataQuality && Array.isArray(plan.dataQuality.warnings) && plan.split && typeof plan.split.rule === 'string' && Array.isArray(plan.split.leakageRisks) &&
    typeof plan.artifactMarkdown === 'string' && typeof plan.artifactFileName === 'string' && typeof plan.boundary === 'string');
}
