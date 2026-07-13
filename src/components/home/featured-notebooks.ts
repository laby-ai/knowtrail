import type { WorkspaceNotebook } from '@/components/home/workspace-types';
import type { Paper, ProjectFolder } from '@/types';

export interface FeaturedNotebook {
  id: string;
  title: string;
  meta: string;
  image: string;
  author: string;
  sourceCount: number;
  accent: string;
  papers: Paper[];
}

const FEATURED_UPDATED_AT = '2026-06-01T00:00:00.000Z';

function samplePaper(input: {
  id: string;
  title: string;
  author: string;
  year: number;
  shortName: string;
  keywords: string[];
  content: string;
}): Paper {
  return {
    id: input.id,
    title: input.title,
    authors: [input.author],
    year: input.year,
    keywords: input.keywords,
    abstract: input.content.slice(0, 260),
    content: input.content,
    rawContent: input.content,
    shortName: input.shortName,
    fileName: `${input.title}.txt`,
    fileType: 'txt',
    fileSize: input.content.length,
    uploadTime: FEATURED_UPDATED_AT,
    isSample: true,
    ingestionStatus: 'succeeded',
    ingestionChunkCount: 4,
    vectorIndex: { status: 'not_configured' },
    mineruFigures: [],
  };
}

const learningPapers = [
  samplePaper({
    id: 'featured-learning-guide',
    title: 'AI 学习路线笔记',
    author: '学习资料',
    year: 2026,
    shortName: '学习路线 2026',
    keywords: ['学习路线', 'AI 工具', '实践任务'],
    content: '这份资料把 AI 学习拆成三个阶段：先了解常用工具和提示方式，再用真实作业或项目练习资料整理，最后建立自己的复盘问题库。每个阶段都保留来源和示例任务，方便回头检查哪些建议来自原文。',
  }),
  samplePaper({
    id: 'featured-learning-questions',
    title: '课堂提问与复盘清单',
    author: '课程笔记',
    year: 2026,
    shortName: '复盘清单 2026',
    keywords: ['提问', '复盘', '引用'],
    content: '资料整理不只是得到答案，更重要的是知道答案依据什么。每次学习后，可以把关键问题、支持段落、仍不确定的点放在一起，形成下次追问和课堂讨论的入口。',
  }),
  samplePaper({
    id: 'featured-learning-cases',
    title: 'AI 实践案例摘录',
    author: '实践材料',
    year: 2026,
    shortName: '实践案例 2026',
    keywords: ['案例', '任务', '迁移'],
    content: '案例资料适合按任务、输入、输出和复盘四类整理。灵笔会把这些片段留在同一个文献本里，后续可以继续生成资料脉络、语音摘要或组会材料。',
  }),
];

const knowledgePapers = [
  samplePaper({
    id: 'featured-knowledge-taxonomy',
    title: '个人知识分类方案',
    author: '知识库笔记',
    year: 2026,
    shortName: '知识分类 2026',
    keywords: ['知识管理', '资料分类', '复用'],
    content: '个人研究知识库可以按主题、项目、引用和待办四类组织。文献本需要保留原始资料和整理后的结论，避免把来源和自己的判断混在一起。',
  }),
  samplePaper({
    id: 'featured-knowledge-review',
    title: '每周复盘模板',
    author: '复盘笔记',
    year: 2026,
    shortName: '每周复盘 2026',
    keywords: ['复盘', '模板', '追问'],
    content: '每周复盘可以先列出新增资料，再标记已经解决的问题和需要继续追问的问题。资料脉络适合用来检查主题之间是否有重复、遗漏或冲突。',
  }),
];

const researchPapers = [
  samplePaper({
    id: 'featured-research-reading',
    title: '论文精读记录',
    author: '科研资料',
    year: 2026,
    shortName: '精读记录 2026',
    keywords: ['论文', '方法', '发现'],
    content: '论文精读时，先记录研究问题、方法、实验设计和主要发现，再把不确定的推断单独列出。后续生成资料脉络时，可以清楚看到方法和结论之间的关系。',
  }),
  samplePaper({
    id: 'featured-research-contrast',
    title: '相关工作对照表',
    author: '文献整理',
    year: 2026,
    shortName: '相关工作 2026',
    keywords: ['相关工作', '对照', '证据'],
    content: '相关工作整理要区分已验证结论、假设、数据限制和可复用方法。文献本可以把每篇资料的贡献和局限放在同一个脉络里，方便写综述或开题报告。',
  }),
];

const productPapers = [
  samplePaper({
    id: 'featured-product-feedback',
    title: '用户反馈摘录',
    author: '产品研究',
    year: 2026,
    shortName: '用户反馈 2026',
    keywords: ['用户反馈', '产品', '体验'],
    content: '用户反馈需要按场景、问题、影响程度和期望结果整理。只看摘要容易漏掉细节，保留原始片段可以让产品判断回到用户真实表达。',
  }),
  samplePaper({
    id: 'featured-product-ideas',
    title: '灵感与需求池',
    author: '产品笔记',
    year: 2026,
    shortName: '需求池 2026',
    keywords: ['需求', '灵感', '优先级'],
    content: '需求池可以把灵感、证据、待验证假设和已确认决策分开。生成资料脉络后，团队能更快看出哪些需求来自同一类问题，哪些只是单点建议。',
  }),
];

export const FEATURED_NOTEBOOKS: FeaturedNotebook[] = [
  {
    id: 'featured-ai-learning',
    title: 'AI 学习指南',
    meta: '3 个示例来源',
    image: 'linear-gradient(135deg, rgba(18,16,13,0.92), rgba(15,23,42,0.72)), radial-gradient(circle at 72% 22%, rgba(244,214,145,0.62), transparent 34%), linear-gradient(115deg, #342b22, #0f172a)',
    author: '学习资料',
    sourceCount: learningPapers.length,
    accent: 'from-stone-100 via-white to-slate-100',
    papers: learningPapers,
  },
  {
    id: 'featured-personal-knowledge',
    title: '个人知识管理',
    meta: '2 个示例来源',
    image: 'linear-gradient(135deg, rgba(12,23,38,0.84), rgba(8,15,28,0.76)), radial-gradient(circle at 62% 35%, rgba(96,165,250,0.7), transparent 28%), linear-gradient(115deg, #7dd3fc, #1e293b)',
    author: '知识库',
    sourceCount: knowledgePapers.length,
    accent: 'from-sky-50 via-white to-cyan-50',
    papers: knowledgePapers,
  },
  {
    id: 'featured-research-reading',
    title: '科研阅读笔记',
    meta: '2 个示例来源',
    image: 'linear-gradient(135deg, rgba(127,29,29,0.86), rgba(15,23,42,0.7)), repeating-linear-gradient(90deg, rgba(255,255,255,0.14) 0 2px, transparent 2px 34px), linear-gradient(115deg, #ef4444, #334155)',
    author: '论文资料',
    sourceCount: researchPapers.length,
    accent: 'from-rose-50 via-white to-slate-100',
    papers: researchPapers,
  },
  {
    id: 'featured-product-ideas',
    title: '产品灵感库',
    meta: '2 个示例来源',
    image: 'linear-gradient(135deg, rgba(15,23,42,0.76), rgba(15,23,42,0.5)), radial-gradient(circle at 62% 46%, rgba(125,211,252,0.86), transparent 23%), radial-gradient(circle at 28% 50%, rgba(251,191,36,0.7), transparent 28%), linear-gradient(115deg, #a7f3d0, #64748b)',
    author: '产品研究',
    sourceCount: productPapers.length,
    accent: 'from-emerald-50 via-white to-sky-50',
    papers: productPapers,
  },
];

export function isFeaturedNotebookId(id: string | null | undefined) {
  return FEATURED_NOTEBOOKS.some(notebook => notebook.id === id);
}

export function featuredNotebookToWorkspace(notebook: FeaturedNotebook): WorkspaceNotebook {
  return {
    id: notebook.id,
    title: notebook.title,
    sourceCount: notebook.sourceCount,
    updatedAt: FEATURED_UPDATED_AT,
    accent: notebook.accent,
  };
}

export function createFeaturedNotebookFolders(notebookId: string | null | undefined): ProjectFolder[] {
  const notebook = FEATURED_NOTEBOOKS.find(item => item.id === notebookId);
  if (!notebook) return [];
  return [{
    id: `${notebook.id}-sources`,
    name: '示例资料',
    papers: notebook.papers,
    createdAt: FEATURED_UPDATED_AT,
    updatedAt: FEATURED_UPDATED_AT,
  }];
}
