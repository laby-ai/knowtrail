import { isResearchReportDocument } from './research-report-document';
import { isKnowledgeMapDocument } from './knowledge-map-document';
import { isDataProcessingDocument } from './data-processing-document';
import { isIllustrationDocument } from './scientific-illustration-document';
import { isLearningMaterials } from './learning-materials';
import { isHtmlDeckDocument, isImageDeckDocument } from './ppt/deck-document';
import type { StudioProductId } from './studio-research-taxonomy';

export const STUDIO_OUTPUT_SOURCES = [
  { kind: 'knowledge-map', tool: 'knowledge', label: '研究脉络', endpoint: '/api/studio/artifacts?kind=knowledge-map', event: 'knowledge-map' },
  { kind: 'data-processing', tool: 'data-processing', label: '数据方案', endpoint: '/api/studio/artifacts?kind=data-processing', event: 'data-processing' },
  { kind: 'scientific-illustration', tool: 'scientific-illustration', label: '科研绘图', endpoint: '/api/studio/artifacts?kind=scientific-illustration', event: 'scientific-illustration' },
  { kind: 'research-report', tool: 'report', label: '报告', endpoint: '/api/studio/artifacts?kind=research-report', event: 'research-report' },
  { kind: 'learning-materials', tool: 'flashcards', label: '学习卡与测验', endpoint: '/api/ai/knowledge-cards', event: 'learning-artifacts' },
  { kind: 'image-deck', tool: 'presentation', label: '图片 PPT', endpoint: '/api/studio/artifacts?kind=image-deck', event: 'image-deck' },
  { kind: 'html-deck', tool: 'presentation', label: 'HTML PPT', endpoint: '/api/studio/artifacts?kind=html-deck', event: 'html-deck' },
  { kind: 'structured-ppt', tool: 'presentation', label: '可编辑 PPT', endpoint: '/api/ai/ppt-v2', event: 'structured-ppt' },
] as const;

export type StudioOutputKind = typeof STUDIO_OUTPUT_SOURCES[number]['kind'];
export interface StudioSavedOutput {
  kind: StudioOutputKind;
  tool: StudioProductId;
  title: string;
  updatedAt: string;
  revision: string;
}

export function studioOutputUrl(kind: StudioOutputKind, notebookId: string, revision?: string) {
  const source = STUDIO_OUTPUT_SOURCES.find(item => item.kind === kind)!;
  const query = new URLSearchParams({ notebookId });
  if (revision) query.set(kind === 'structured-ppt' ? 'artifactId' : 'revision', revision);
  return `${source.endpoint}${source.endpoint.includes('?') ? '&' : '?'}${query}`;
}

export function describeStudioOutput(kind: StudioOutputKind, payload: unknown): StudioSavedOutput | null {
  if (!payload || typeof payload !== 'object') throw new Error('保存信息不完整，请重新读取。');
  const source = STUDIO_OUTPUT_SOURCES.find(item => item.kind === kind)!;
  const value = payload as { document?: { revision?: unknown; updatedAt?: unknown; data?: unknown }; artifact?: { id?: unknown; fileName?: unknown; createdAt?: unknown } };
  const document = value.document;
  const data = document?.data;
  let title: string | null = null;
  let revision: unknown = document?.revision;
  let updatedAt: unknown = document?.updatedAt;
  switch (kind) {
    case 'research-report':
      if (!isResearchReportDocument(data)) throw new Error('报告保存信息不完整。');
      if (data.report) title = data.report.question;
      break;
    case 'knowledge-map':
      if (!isKnowledgeMapDocument(data)) throw new Error('研究脉络保存信息不完整。');
      if (data.session) title = data.session.map.title;
      break;
    case 'data-processing':
      if (!isDataProcessingDocument(data)) throw new Error('数据方案保存信息不完整。');
      if (data.plan) title = data.plan.dataset.sourceTitle;
      break;
    case 'scientific-illustration':
      if (!isIllustrationDocument(data)) throw new Error('科研绘图保存信息不完整。');
      if (data.result) title = data.result.purpose;
      break;
    case 'learning-materials':
      if (!isLearningMaterials(data)) throw new Error('学习材料保存信息不完整。');
      if (data.cards.length) title = data.generation?.question || data.cards[0].title;
      break;
    case 'image-deck':
      if (!isImageDeckDocument(data)) throw new Error('PPT保存信息不完整。');
      if (data.deck) title = data.deck.deckTitle;
      break;
    case 'html-deck':
      if (!isHtmlDeckDocument(data)) throw new Error('PPT保存信息不完整。');
      if (data.deck) title = data.deck.deckTitle;
      break;
    case 'structured-ppt':
      revision = value.artifact?.id;
      updatedAt = value.artifact?.createdAt;
      if (typeof value.artifact?.fileName === 'string') title = value.artifact.fileName;
      else throw new Error('PPT保存信息不完整。');
  }
  if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision) || typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt))) throw new Error('保存版本不完整，请重新读取。');
  return title === null ? null : { kind, tool: source.tool, title: title || source.label, revision, updatedAt };
}
