import { isDiscoverSearchDocument } from './discover-search-document';
import type { DiscoveredSourceFileInput } from './discovered-source-file';
import { sanitizePptOutlineDraft, type PptOutlineDraftItem } from './ppt/outline-draft';
import { isResearchDesignDocument } from './research-agent-design';
import type { ResearchDesignDocument } from './research-design-document';
import { isGeneratedKnowledgeMap } from './research-agent-map';
import type { KnowledgeMapDocument } from './knowledge-map-document';
import { isDataPlanInput, isGeneratedDataPlan, type DataPlanInput } from './research-agent-data';
import type { DataProcessingDocument } from './data-processing-document';
import { isLearningInput, isGeneratedLearning, type LearningInput } from './research-agent-learning';
import type { LearningMaterials } from './learning-materials';
import { isIllustrationInput, isGeneratedIllustration, type IllustrationInput } from './research-agent-illustration';
import type { IllustrationDocument } from './scientific-illustration-document';

export const RESEARCH_PLUGINS = {
  'paper-search': '论文检索', 'deep-research': '深度研究',
  'hypothesis-generation': '假设生成', 'experiment-design': '实验设计',
  'knowledge-map': '研究脉络', 'data-processing': '数据处理',
  'scientific-illustration': '科研绘图', presentation: 'PPT 制作',
  report: '报告', 'knowledge-cards': '学习卡', quiz: '测验',
} as const;
export type ResearchPluginId = keyof typeof RESEARCH_PLUGINS;
export interface ResearchReportReference {
  sourceIds: string[];
  question: string;
  revision: string;
  runId: string;
  status: 'complete' | 'incomplete';
}
export interface ResearchDesignReference extends ResearchReportReference {
  kind: 'hypothesis-generation' | 'experiment-design';
}
export interface ResearchKnowledgeMapReference extends ResearchReportReference { deepExtract: boolean }
export interface ResearchDataPlanReference extends ResearchReportReference, DataPlanInput {}
export interface ResearchLearningReference extends ResearchReportReference, LearningInput {}
export interface ResearchIllustrationReference extends Omit<ResearchReportReference, 'question'>, IllustrationInput { imageId: string }
export function isResearchIllustrationReference(value: unknown): value is ResearchIllustrationReference {
  if (!value || typeof value !== 'object') return false;
  const v = value as ResearchIllustrationReference;
  return isResearchReportReference({ ...v, question: v.purpose }) && v.status === 'incomplete' && v.sourceIds.length <= 12
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.imageId)
    && isIllustrationInput({ purpose: v.purpose, figureKind: v.figureKind, aspectRatio: v.aspectRatio, requiredLabels: v.requiredLabels });
}
export interface PendingIllustration extends Omit<ResearchIllustrationReference, 'revision' | 'status'> { data: IllustrationDocument; expectedRevision: string | null }
export function isPendingIllustration(value: unknown): value is PendingIllustration {
  if (!value || typeof value !== 'object') return false;
  const v = value as PendingIllustration;
  return isResearchIllustrationReference({ ...v, revision: v.expectedRevision || '0'.repeat(64), status: 'incomplete' })
    && (v.expectedRevision === null || /^[a-f0-9]{64}$/.test(v.expectedRevision))
    && isGeneratedIllustration(v.data, v.runId, v) && v.data.result.id === v.imageId && JSON.stringify(v.data).length <= 500_000;
}
export function isResearchLearningReference(value: unknown): value is ResearchLearningReference {
  return isResearchReportReference(value) && isLearningInput({ kind: (value as ResearchLearningReference).kind, question: value.question });
}
export interface PendingLearning extends Omit<ResearchLearningReference, 'revision' | 'status'> { data: LearningMaterials; expectedRevision: string | null }
export function isPendingLearning(value: unknown): value is PendingLearning {
  if (!value || typeof value !== 'object') return false;
  const v = value as PendingLearning;
  return isResearchLearningReference({ ...v, revision: v.expectedRevision || '0'.repeat(64), status: 'incomplete' })
    && (v.expectedRevision === null || /^[a-f0-9]{64}$/.test(v.expectedRevision))
    && isGeneratedLearning(v.data, v.runId, v) && JSON.stringify(v.data).length <= 500_000;
}
export type LearningProgress = Pick<LearningMaterials, 'cardIndex' | 'quizIndex' | 'answers'>;
function isLearningProgress(value: unknown): value is LearningProgress {
  if (!value || typeof value !== 'object') return false;
  const v = value as LearningProgress;
  return Number.isInteger(v.cardIndex) && v.cardIndex >= 0 && v.cardIndex < 50
    && Number.isInteger(v.quizIndex) && v.quizIndex >= 0 && v.quizIndex < 5
    && Boolean(v.answers && typeof v.answers === 'object' && !Array.isArray(v.answers)) && Object.keys(v.answers).length <= 5
    && Object.values(v.answers).every(n => Number.isInteger(n) && n >= 0 && n <= 3);
}
export function isResearchDataPlanReference(value: unknown): value is ResearchDataPlanReference {
  if (!isResearchReportReference(value)) return false;
  const v = value as ResearchDataPlanReference;
  return v.status === 'complete' && v.sourceIds.length === 1 && v.sourceIds[0] === v.sourceId
    && isDataPlanInput({ sourceId: v.sourceId, question: v.question, sampleUnit: v.sampleUnit, taskFamily: v.taskFamily, targetColumn: v.targetColumn, splitColumn: v.splitColumn });
}
export interface PendingDataPlan extends Omit<ResearchDataPlanReference, 'revision' | 'status'> { data: DataProcessingDocument; expectedRevision: string | null }
export function isPendingDataPlan(value: unknown): value is PendingDataPlan {
  if (!value || typeof value !== 'object') return false;
  const v = value as PendingDataPlan;
  return isResearchDataPlanReference({ ...v, revision: v.expectedRevision || '0'.repeat(64), status: 'complete' })
    && (v.expectedRevision === null || /^[a-f0-9]{64}$/.test(v.expectedRevision))
    && isGeneratedDataPlan(v.data, v.runId, v) && JSON.stringify(v.data).length <= 500_000;
}
export function isResearchKnowledgeMapReference(value: unknown): value is ResearchKnowledgeMapReference {
  return isResearchReportReference(value) && typeof (value as ResearchKnowledgeMapReference).deepExtract === 'boolean';
}
export interface PendingKnowledgeMap extends Omit<ResearchKnowledgeMapReference, 'revision' | 'status'> {
  data: KnowledgeMapDocument;
  expectedRevision: string | null;
}
export function isPendingKnowledgeMap(value: unknown): value is PendingKnowledgeMap {
  if (!value || typeof value !== 'object') return false;
  const v = value as PendingKnowledgeMap;
  return isResearchKnowledgeMapReference({ ...v, revision: v.expectedRevision || '0'.repeat(64), status: 'incomplete' })
    && (v.expectedRevision === null || /^[a-f0-9]{64}$/.test(v.expectedRevision))
    && isGeneratedKnowledgeMap(v.data, v.runId, v) && JSON.stringify(v.data).length <= 500_000;
}
export function isResearchDesignReference(value: unknown): value is ResearchDesignReference {
  return isResearchReportReference(value) && ['hypothesis-generation', 'experiment-design'].includes((value as ResearchDesignReference).kind);
}
export interface PendingResearchDesign extends Omit<ResearchDesignReference, 'revision' | 'status'> {
  data: ResearchDesignDocument;
  expectedRevision: string | null;
}
export function isPendingResearchDesign(value: unknown): value is PendingResearchDesign {
  if (!value || typeof value !== 'object') return false;
  const draft = value as PendingResearchDesign;
  return isResearchDesignReference({ ...draft, revision: draft.expectedRevision || '0'.repeat(64), status: 'incomplete' })
    && (draft.expectedRevision === null || /^[a-f0-9]{64}$/.test(draft.expectedRevision))
    && isResearchDesignDocument(draft.data, draft.kind) && draft.data.result?.runId === draft.runId
    && ('question' in draft.data ? draft.data.question : draft.data.form.question) === draft.question
    && JSON.stringify(draft.data).length <= 500_000;
}
export function isResearchReportReference(value: unknown): value is ResearchReportReference {
  if (!value || typeof value !== 'object') return false;
  const report = value as Partial<ResearchReportReference>;
  return Boolean(Array.isArray(report.sourceIds) && report.sourceIds.length > 0 && report.sourceIds.length <= 20
    && report.sourceIds.every(id => typeof id === 'string' && /^[\w.-]{1,180}$/.test(id))
    && new Set(report.sourceIds).size === report.sourceIds.length
    && typeof report.question === 'string' && report.question.trim() && report.question.length <= 1200
    && typeof report.revision === 'string' && /^[a-f0-9]{64}$/.test(report.revision)
    && typeof report.runId === 'string' && /^[a-f0-9-]{36}$/i.test(report.runId)
    && ['complete', 'incomplete'].includes(report.status || ''));
}
export interface ResearchPresentationArtifact { id: string; fileName: string; slideCount: number }
export interface ResearchPresentationPlan {
  sourceIds: string[];
  outlineDraft: PptOutlineDraftItem[];
  artifact?: ResearchPresentationArtifact;
}
export function isResearchPresentationPlan(value: unknown): value is ResearchPresentationPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<ResearchPresentationPlan>;
  if (!Array.isArray(plan.sourceIds) || !plan.sourceIds.length || plan.sourceIds.length > 20
    || !plan.sourceIds.every(id => typeof id === 'string' && /^[\w.-]{1,180}$/.test(id))
    || new Set(plan.sourceIds).size !== plan.sourceIds.length
    || !Array.isArray(plan.outlineDraft) || !plan.outlineDraft.length || plan.outlineDraft.length > 18
    || JSON.stringify(sanitizePptOutlineDraft(plan.outlineDraft)) !== JSON.stringify(plan.outlineDraft)) return false;
  const artifact = plan.artifact;
  return artifact === undefined || Boolean(artifact && /^[a-f0-9]{64}$/.test(artifact.id)
    && typeof artifact.fileName === 'string' && artifact.fileName.length > 0 && artifact.fileName.length <= 180
    && Number.isInteger(artifact.slideCount) && artifact.slideCount === plan.outlineDraft.length);
}
export interface ResearchToolCall {
  id: string;
  plugin: ResearchPluginId;
  query: string;
  status: 'running' | 'ready' | 'failed';
  error?: string;
  results?: DiscoveredSourceFileInput[];
  presentation?: ResearchPresentationPlan;
  report?: ResearchReportReference;
  design?: ResearchDesignReference;
  pendingDesign?: PendingResearchDesign;
  knowledgeMap?: ResearchKnowledgeMapReference;
  pendingKnowledgeMap?: PendingKnowledgeMap;
  dataPlan?: ResearchDataPlanReference;
  pendingDataPlan?: PendingDataPlan;
  learning?: ResearchLearningReference;
  pendingLearning?: PendingLearning;
  learningProgress?: LearningProgress;
  illustration?: ResearchIllustrationReference;
  pendingIllustration?: PendingIllustration;
}
export function isResearchPlugin(value: unknown): value is ResearchPluginId {
  return typeof value === 'string' && Object.hasOwn(RESEARCH_PLUGINS, value);
}
export function isResearchToolCall(value: unknown): value is ResearchToolCall {
  if (!value || typeof value !== 'object') return false;
  const call = value as Partial<ResearchToolCall>;
  return typeof call.id === 'string' && call.id.length <= 100 && isResearchPlugin(call.plugin)
    && typeof call.query === 'string' && call.query.length <= 4000
    && ['running', 'ready', 'failed'].includes(call.status || '')
    && (call.error === undefined || typeof call.error === 'string' && call.error.length <= 1000)
    && (call.results === undefined || isDiscoverSearchDocument({ query: '', optimizedQuery: '', planKeywords: [], scope: 'scholar', selected: [], provider: 'arxiv', searched: true, results: call.results }))
    && (call.presentation === undefined || call.plugin === 'presentation' && call.results === undefined && isResearchPresentationPlan(call.presentation))
    && (call.report === undefined || call.plugin === 'report' && call.results === undefined && call.presentation === undefined && isResearchReportReference(call.report))
    && (call.design === undefined || call.results === undefined && call.presentation === undefined && call.report === undefined && isResearchDesignReference(call.design) && call.plugin === call.design.kind)
    && (call.pendingDesign === undefined || call.status === 'failed' && call.results === undefined && call.presentation === undefined && call.report === undefined && call.design === undefined && isPendingResearchDesign(call.pendingDesign) && call.plugin === call.pendingDesign.kind)
    && (call.knowledgeMap === undefined || call.plugin === 'knowledge-map' && !call.results && !call.presentation && !call.report && !call.design && !call.pendingDesign && isResearchKnowledgeMapReference(call.knowledgeMap))
    && (call.pendingKnowledgeMap === undefined || call.status === 'failed' && call.plugin === 'knowledge-map' && !call.results && !call.presentation && !call.report && !call.design && !call.pendingDesign && !call.knowledgeMap && isPendingKnowledgeMap(call.pendingKnowledgeMap))
    && (call.dataPlan === undefined || call.status === 'ready' && call.plugin === 'data-processing' && !call.results && !call.presentation && !call.report && !call.design && !call.pendingDesign && !call.knowledgeMap && !call.pendingKnowledgeMap && !call.pendingDataPlan && isResearchDataPlanReference(call.dataPlan))
    && (call.pendingDataPlan === undefined || call.status === 'failed' && call.plugin === 'data-processing' && !call.results && !call.presentation && !call.report && !call.design && !call.pendingDesign && !call.knowledgeMap && !call.pendingKnowledgeMap && !call.dataPlan && isPendingDataPlan(call.pendingDataPlan))
    && (call.learning === undefined || call.status === 'ready' && call.plugin === call.learning.kind && !call.results && !call.presentation && !call.report && !call.design && !call.pendingDesign && !call.knowledgeMap && !call.pendingKnowledgeMap && !call.dataPlan && !call.pendingDataPlan && !call.pendingLearning && isResearchLearningReference(call.learning))
    && (call.pendingLearning === undefined || call.status === 'failed' && call.plugin === call.pendingLearning.kind && !call.results && !call.presentation && !call.report && !call.design && !call.pendingDesign && !call.knowledgeMap && !call.pendingKnowledgeMap && !call.dataPlan && !call.pendingDataPlan && !call.learning && isPendingLearning(call.pendingLearning))
    && (call.learningProgress === undefined || Boolean(call.learning && isLearningProgress(call.learningProgress)))
    && (call.illustration === undefined || call.status === 'ready' && call.plugin === 'scientific-illustration' && !call.results && !call.presentation && !call.report && !call.design && !call.pendingDesign && !call.knowledgeMap && !call.pendingKnowledgeMap && !call.dataPlan && !call.pendingDataPlan && !call.learning && !call.pendingLearning && !call.pendingIllustration && isResearchIllustrationReference(call.illustration))
    && (call.pendingIllustration === undefined || call.status === 'failed' && call.plugin === 'scientific-illustration' && !call.results && !call.presentation && !call.report && !call.design && !call.pendingDesign && !call.knowledgeMap && !call.pendingKnowledgeMap && !call.dataPlan && !call.pendingDataPlan && !call.learning && !call.pendingLearning && !call.illustration && isPendingIllustration(call.pendingIllustration));
}
