import type { DeckOutlinePage } from '@/lib/ppt/html-deck-generation';

function arrayFromJson(raw: string, key: string, count: number, label: string): unknown[] {
  try {
    const value: unknown = JSON.parse(raw);
    const items = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : null;
    if (Array.isArray(items) && items.length === count) return items;
  } catch { /* Invalid model formatting must not be presented as an image-service error. */ }
  throw new Error(`${label}格式不完整，本次生成已停止，已保存简报仍保留。`);
}

export function parseDeckOutline(raw: string, count: number): DeckOutlinePage[] {
  const pages = arrayFromJson(raw, 'pages', count, '大纲');
  if (!pages.every((page): page is DeckOutlinePage => {
    if (!page || typeof page !== 'object') return false;
    const value = page as Record<string, unknown>;
    return typeof value.title === 'string' && Boolean(value.title.trim()) && Array.isArray(value.points) && value.points.every(p => typeof p === 'string') && (value.layoutHint === undefined || typeof value.layoutHint === 'string') && (value.part === undefined || typeof value.part === 'string');
  })) throw new Error('大纲标题或要点不完整，本次未保存。');
  return pages;
}

export function parseDeckNarrations(raw: string, count: number): string[] {
  const narrations = arrayFromJson(raw, 'narrations', count, '演讲稿');
  if (!narrations.every((value): value is string => typeof value === 'string' && Boolean(value.trim()))) throw new Error('演讲稿未完整生成，本次未保存。');
  return narrations;
}
