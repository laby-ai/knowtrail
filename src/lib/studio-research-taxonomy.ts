export type StudioResearchCategoryId =
  | 'literature-evidence'
  | 'research-ideation'
  | 'results-expression'
  | 'collaboration-memory';

export type StudioProductId = 'paper-search' | 'deep-research' | 'hypothesis-generation' | 'data-processing' | 'experiment-design' | 'knowledge' | 'presentation' | 'virtual-classroom';

export type StudioProductAvailability = 'ready' | 'runtime-dependent';

export interface StudioResearchCategory {
  id: StudioResearchCategoryId;
  label: string;
}

export interface StudioResearchProduct {
  id: StudioProductId;
  label: string;
  desc: string;
  categoryId: StudioResearchCategoryId;
  availability: StudioProductAvailability;
}

export const STUDIO_RESEARCH_CATEGORIES = [
  { id: 'literature-evidence', label: '文献证据' },
  { id: 'research-ideation', label: '研究构思' },
  { id: 'results-expression', label: '成果表达' },
  { id: 'collaboration-memory', label: '协作沉淀' },
] as const satisfies readonly StudioResearchCategory[];

export const STUDIO_RESEARCH_PRODUCTS = [
  {
    id: 'paper-search',
    label: '论文检索',
    categoryId: 'literature-evidence',
    desc: '检索、核验并加入文献库',
    availability: 'ready',
  },
  {
    id: 'deep-research',
    label: '深度研究',
    categoryId: 'literature-evidence',
    desc: '基于已选来源生成可追溯报告',
    availability: 'ready',
  },
  {
    id: 'knowledge',
    label: '研究脉络',
    categoryId: 'literature-evidence',
    desc: '核心词、关系与证据',
    availability: 'ready',
  },
  {
    id: 'hypothesis-generation',
    label: '假设生成',
    categoryId: 'research-ideation',
    desc: '依据、反例与可证伪预测',
    availability: 'ready',
  },
  {
    id: 'data-processing',
    label: '数据处理',
    categoryId: 'research-ideation',
    desc: '真实表格诊断与基线方案',
    availability: 'ready',
  },
  {
    id: 'experiment-design',
    label: '实验设计',
    categoryId: 'research-ideation',
    desc: '对照、随机化与预注册协议',
    availability: 'ready',
  },
  {
    id: 'presentation',
    label: 'PPT 制作',
    categoryId: 'results-expression',
    desc: '图片页 / 可编辑 PPT',
    availability: 'ready',
  },
  {
    id: 'virtual-classroom',
    label: '虚拟课堂',
    categoryId: 'collaboration-memory',
    availability: 'runtime-dependent',
    desc: '需连接课堂服务',
  },
] as const satisfies readonly StudioResearchProduct[];

export function getVisibleStudioCategories() {
  return STUDIO_RESEARCH_CATEGORIES.map(category => ({
    ...category,
    products: STUDIO_RESEARCH_PRODUCTS.filter(product => product.categoryId === category.id),
  })).filter(category => category.products.length > 0);
}
