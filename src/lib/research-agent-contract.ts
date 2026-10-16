import { isDiscoverSearchDocument } from './discover-search-document';
import type { DiscoveredSourceFileInput } from './discovered-source-file';

export const RESEARCH_PLUGINS = {
  'paper-search': '论文检索', 'deep-research': '深度研究',
  'hypothesis-generation': '假设生成', 'experiment-design': '实验设计',
  'knowledge-map': '研究脉络', 'data-processing': '数据处理',
  'scientific-illustration': '科研绘图', presentation: 'PPT 制作',
  report: '报告', 'knowledge-cards': '学习卡', quiz: '测验',
} as const;
export type ResearchPluginId = keyof typeof RESEARCH_PLUGINS;
export interface ResearchToolCall {
  id: string;
  plugin: ResearchPluginId;
  query: string;
  status: 'running' | 'ready' | 'failed';
  error?: string;
  results?: DiscoveredSourceFileInput[];
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
    && (call.results === undefined || isDiscoverSearchDocument({ query: '', optimizedQuery: '', planKeywords: [], scope: 'scholar', selected: [], provider: 'arxiv', searched: true, results: call.results }));
}
