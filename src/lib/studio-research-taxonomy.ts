export type StudioResearchCategoryId =
  | 'literature-evidence'
  | 'research-ideation'
  | 'results-expression'
  | 'collaboration-memory';

export type StudioProductId = 'knowledge' | 'presentation' | 'virtual-classroom';

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
    id: 'knowledge',
    label: '研究脉络',
    categoryId: 'literature-evidence',
    desc: '核心词、关系与证据',
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
