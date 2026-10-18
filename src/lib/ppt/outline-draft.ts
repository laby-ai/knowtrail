import type { Paper } from '@/types';

export type PptOutlineDraftItem = {
  id: string;
  title: string;
  focus: string;
  sourceLabel: string;
};

export type PptOutlineDraftSlideType =
  | 'cover'
  | 'background'
  | 'gap'
  | 'method'
  | 'result'
  | 'discussion'
  | 'conclusion'
  | 'synthesis';

export type PptOutlineDraftStructureItem = {
  type: PptOutlineDraftSlideType;
  title: string;
  discourseRef: string;
};

const MAX_OUTLINE_ITEMS = 18;
const MAX_TITLE_LENGTH = 80;
const MAX_FOCUS_LENGTH = 220;
const MAX_SOURCE_LABEL_LENGTH = 80;
const DRAFT_FOCUS_LENGTH = 140;
const GENERIC_SOURCE_LABEL = /^(?:未解析作者|未知作者|作者未知|unknown author)(?:[.·_\s-]|$)/i;
const PLACEHOLDER_SUMMARY = /^该文件包含了关于.+的(?:内容)?[。.]?$/;

function cleanText(value: unknown, maxLength: number): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function compactText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function shortenText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function resolveSourceLabel(paper: Paper, index: number): string {
  const shortName = compactText(paper.shortName);
  const title = compactText(paper.title);
  const preferred = shortName && !GENERIC_SOURCE_LABEL.test(shortName) ? shortName : title;
  return shortenText(preferred || `资料 ${index + 1}`, 42);
}

function stripExtractionWrapper(value: string): string {
  const abstractMarker = value.lastIndexOf('摘要：');
  return abstractMarker >= 0 ? value.slice(abstractMarker + 3).trim() : value;
}

function completeFocus(value: string): string {
  if (value.length <= DRAFT_FOCUS_LENGTH) return value;

  const withinLimit = value.slice(0, DRAFT_FOCUS_LENGTH);
  const punctuation = Math.max(
    withinLimit.lastIndexOf('。'),
    withinLimit.lastIndexOf('！'),
    withinLimit.lastIndexOf('？'),
    withinLimit.lastIndexOf('；'),
    withinLimit.lastIndexOf('!'),
    withinLimit.lastIndexOf('?'),
    withinLimit.lastIndexOf(';'),
  );
  if (punctuation >= 24) return withinLimit.slice(0, punctuation + 1);
  return shortenText(value, DRAFT_FOCUS_LENGTH);
}

function resolveSourceFocus(paper: Paper, sourceLabel: string): string {
  const candidates = [paper.abstract, paper.content, paper.rawContent]
    .map(value => stripExtractionWrapper(compactText(value)))
    .filter(Boolean);
  const evidence = candidates.find(value => !PLACEHOLDER_SUMMARY.test(value));

  if (!evidence) {
    return `围绕“${sourceLabel}”提炼可核验的论点、依据与局限；资料未提供的内容不作补写。`;
  }
  return completeFocus(evidence);
}

export function buildPptOutlineDraft(papers: Paper[], duration: number): PptOutlineDraftItem[] {
  const sourceSlides = papers.slice(0, 4).map((paper, index) => {
    const sourceLabel = resolveSourceLabel(paper, index);
    return {
      id: `source-${paper.id || index}`,
      title: index === 0 ? '资料背景与核心问题' : `${sourceLabel}：主要证据与局限`,
      focus: resolveSourceFocus(paper, sourceLabel),
      sourceLabel,
    };
  });

  return [
    {
      id: 'opening',
      title: '封面与汇报目标',
      focus: `说明本次简报的范围、受众和预计 ${duration} 分钟讲述节奏。`,
      sourceLabel: '汇报设置',
    },
    ...sourceSlides,
    {
      id: 'synthesis',
      title: '综合判断与行动建议',
      focus: '横向比较资料之间的一致结论、分歧和可落地下一步。',
      sourceLabel: papers.length > 1 ? `${papers.length} 个来源综合` : '资料综合',
    },
  ];
}

export function sanitizePptOutlineDraft(input: unknown): PptOutlineDraftItem[] {
  if (!Array.isArray(input)) return [];

  return input
    .slice(0, MAX_OUTLINE_ITEMS)
    .map((item, index) => {
      const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const title = cleanText(record.title, MAX_TITLE_LENGTH);
      const focus = cleanText(record.focus, MAX_FOCUS_LENGTH);
      if (!title && !focus) return null;

      return {
        id: cleanText(record.id, 64) || `outline-${index + 1}`,
        title: title || `第 ${index + 1} 页`,
        focus: focus || '围绕所选资料提炼可验证内容。',
        sourceLabel: cleanText(record.sourceLabel, MAX_SOURCE_LABEL_LENGTH) || '用户确认大纲',
      };
    })
    .filter((item): item is PptOutlineDraftItem => Boolean(item));
}

export function formatPptOutlineDraftForPrompt(items: PptOutlineDraftItem[]): string {
  if (items.length === 0) return '';

  return items
    .map((item, index) => {
      const source = item.sourceLabel ? ` | 来源: ${item.sourceLabel}` : '';
      return `${index + 1}. ${item.title}${source}\n   重点: ${item.focus}`;
    })
    .join('\n');
}

export function inferPptOutlineDraftSlideType(
  item: PptOutlineDraftItem,
  index: number,
  total: number,
): PptOutlineDraftSlideType {
  const text = `${item.title} ${item.focus}`;
  if (/^封面(?:$|[：:与、\s])/.test(item.title.trim())) return 'cover';
  if (index === total - 1 && /综合|判断|建议|总结|结论|下一步/.test(text)) return 'conclusion';
  if (/背景|目标|范围|现状/.test(text)) return 'background';
  if (/风险|局限|挑战|缺口|问题/.test(text)) return 'gap';
  if (/方法|流程|方案|执行|路径|步骤/.test(text)) return 'method';
  if (/结果|发现|数据|指标|证据|表现/.test(text)) return 'result';
  if (/对比|比较|分歧|异同|差异/.test(text)) return 'discussion';
  return 'synthesis';
}

export function buildPptStructureDraftFromOutline(items: PptOutlineDraftItem[]): PptOutlineDraftStructureItem[] {
  return items.map((item, index) => ({
    type: inferPptOutlineDraftSlideType(item, index, items.length),
    title: item.title,
    discourseRef: `user-outline:${index + 1}:${item.sourceLabel}`,
  }));
}
