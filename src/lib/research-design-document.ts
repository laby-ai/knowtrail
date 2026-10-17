import { parseHypothesisGenerationOutput, type HypothesisCard } from '@/lib/hypothesis-generation-contract';
import { parseExperimentDesignOutput, type ExperimentDesignProtocol } from '@/lib/experiment-design-contract';
import { studioSessionStorageKey } from '@/lib/studio-session-storage';
import type { Citation, RetrievalMetadata } from '@/types';

export interface DesignEvidenceStatus { answerStatus?: 'complete' | 'incomplete' | 'no-evidence'; invalidEvidenceMarkers?: number[]; retrievalLimits?: string[] }
interface ResultEvidence { runId: string; citations: Citation[]; retrieval: RetrievalMetadata | null; status: DesignEvidenceStatus }
export interface HypothesisResult extends ResultEvidence { hypotheses: HypothesisCard[] }
export interface HypothesisDocument { question: string; result: HypothesisResult | null }
export interface ExperimentForm { question: string; hypothesis: string; experimentalUnit: string; armsText: string; primaryOutcome: string; constraints: string; alpha: number; targetPower: number }
export interface ExperimentResult extends ResultEvidence { protocol: ExperimentDesignProtocol; artifactMarkdown: string; artifactFileName: string }
export interface ExperimentDocument { form: ExperimentForm; result: ExperimentResult | null }
export type ResearchDesignDocument = HypothesisDocument | ExperimentDocument;
export type ResearchDesignKind = 'hypothesis-generation' | 'experiment-design';
export const emptyHypothesis = (): HypothesisDocument => ({ question: '', result: null });
export const emptyExperiment = (): ExperimentDocument => ({ form: { question: '', hypothesis: '', experimentalUnit: '', armsText: '处理组, 对照组', primaryOutcome: '', constraints: '', alpha: 0.05, targetPower: 0.8 }, result: null });

function evidence(value: ResultEvidence) {
  return typeof value.runId === 'string' && /^[a-f0-9-]{36}$/i.test(value.runId) && Array.isArray(value.citations) && value.citations.length <= 100
    && value.citations.every(c => c && typeof c.paperId === 'string' && typeof c.paperShortName === 'string' && typeof c.excerpt === 'string')
    && (value.retrieval === null || typeof value.retrieval?.mode === 'string') && Boolean(value.status && ['complete', 'incomplete', 'no-evidence'].includes(value.status.answerStatus || ''));
}
export function isHypothesisDocument(value: unknown): value is HypothesisDocument {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Partial<HypothesisDocument>;
  if (typeof doc.question !== 'string' || doc.question.length > 1200) return false;
  if (doc.result === null) return true;
  try { return Boolean(doc.result && evidence(doc.result) && parseHypothesisGenerationOutput(JSON.stringify(doc.result)).hypotheses.length); } catch { return false; }
}
export function isExperimentDocument(value: unknown): value is ExperimentDocument {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Partial<ExperimentDocument>; const form = doc.form;
  if (!form || !['question', 'hypothesis', 'experimentalUnit', 'armsText', 'primaryOutcome', 'constraints'].every(k => typeof form[k as keyof ExperimentForm] === 'string' && String(form[k as keyof ExperimentForm]).length <= 1200)
    || !Number.isFinite(form.alpha) || !Number.isFinite(form.targetPower)) return false;
  if (doc.result === null) return true;
  try { return Boolean(doc.result && evidence(doc.result) && typeof doc.result.artifactMarkdown === 'string' && typeof doc.result.artifactFileName === 'string' && parseExperimentDesignOutput(JSON.stringify(doc.result.protocol))); } catch { return false; }
}

function legacy(scope: string, tool: string, field: string): unknown {
  try { return JSON.parse(window.sessionStorage.getItem(studioSessionStorageKey(scope, tool, field)) || 'null'); } catch { return null; }
}
export function legacyHypothesis(scope: string): HypothesisDocument | null {
  const question = legacy(scope, 'hypothesis-generation', 'question');
  return typeof question === 'string' && question ? { question, result: null } : null;
}
export function legacyExperiment(scope: string): ExperimentDocument | null {
  const doc = emptyExperiment(); let found = false;
  for (const [key, field] of Object.entries({ question: 'question', hypothesis: 'hypothesis', experimentalUnit: 'experimental-unit', armsText: 'arms', primaryOutcome: 'primary-outcome', constraints: 'constraints', alpha: 'alpha', targetPower: 'target-power' })) {
    const value = legacy(scope, 'experiment-design', field);
    if (value !== null && typeof value === typeof doc.form[key as keyof ExperimentForm]) { Object.assign(doc.form, { [key]: value }); found = true; }
  }
  return found && isExperimentDocument(doc) ? doc : null;
}
