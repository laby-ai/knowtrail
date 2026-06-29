import type { Paper } from '@/types';

function configuredClassroomOrigin(): string {
  return (process.env.NEXT_PUBLIC_VIRTUAL_CLASSROOM_ORIGIN || '').trim().replace(/\/$/, '');
}

export const CLASSROOM_ORIGIN = configuredClassroomOrigin() || '/virtual-classroom';

export const virtualClassroomTypeLabels: Record<string, string> = {
  slide: '讲解',
  quiz: '测验',
  project: '项目',
};

export function getVirtualClassroomTypeLabel(type: string) {
  return virtualClassroomTypeLabels[type] || type;
}

export function buildClassroomDraft(papers: Paper[]) {
  if (papers.length === 0) {
    return '请创建一节适合个人资料学习的虚拟课堂，包含讲解、测验和互动任务。';
  }

  const sourceLines = papers.slice(0, 4).map((paper, index) => {
    const text = (paper.abstract || paper.rawContent || paper.content || '').replace(/\s+/g, ' ').trim();
    const snippet = text ? `：${text.slice(0, 90)}` : '';
    return `${index + 1}. ${paper.title || paper.shortName || '未命名资料'}${snippet}`;
  });

  return [
    '请基于以下资料创建一节虚拟课堂。',
    '要求：先讲清核心概念，再安排测验和互动任务，适合在资料工作台中学习。',
    `资料数量：${papers.length}`,
    ...sourceLines,
  ].join('\n');
}

export function buildClassroomUrl(draft: string, originOverride?: string) {
  const externalOrigin = (originOverride || configuredClassroomOrigin()).trim().replace(/\/$/, '');
  if (!externalOrigin) {
    const params = new URLSearchParams({
      draft: draft.slice(0, 900),
      embed: 'lingbi',
    });
    return `/virtual-classroom?${params.toString()}`;
  }

  if (externalOrigin.startsWith('/')) {
    const params = new URLSearchParams({
      draft: draft.slice(0, 900),
      embed: 'lingbi',
    });
    return `${externalOrigin}?${params.toString()}`;
  }

  const url = new URL(externalOrigin);
  url.searchParams.set('draft', draft.slice(0, 900));
  url.searchParams.set('embed', 'lingbi');
  return url.toString();
}

export function buildVirtualClassroomEntry(papers: Paper[], originOverride?: string) {
  const sourceSummary = papers.slice(0, 3).map(paper => paper.title || paper.shortName || '未命名资料').join('、');
  return {
    url: buildClassroomUrl(buildClassroomDraft(papers), originOverride),
    title: papers.length > 0 ? `基于 ${papers.length} 个资料的虚拟课堂` : '虚拟教室',
    source: 'recent' as const,
    sourceCount: papers.length,
    sourceIds: papers.map(paper => paper.id),
    sourceSummary,
  };
}
