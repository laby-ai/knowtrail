import { isDiscoverSearchDocument } from './discover-search-document';
import type { DiscoveredSourceFileInput } from './discovered-source-file';
import { sanitizePptOutlineDraft, type PptOutlineDraftItem } from './ppt/outline-draft';
import { isResearchDesignDocument } from './research-agent-design';
import type { ResearchDesignDocument } from './research-design-document';

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
    && (call.pendingDesign === undefined || call.status === 'failed' && call.results === undefined && call.presentation === undefined && call.report === undefined && call.design === undefined && isPendingResearchDesign(call.pendingDesign) && call.plugin === call.pendingDesign.kind);
}
