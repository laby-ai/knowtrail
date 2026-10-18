import type { Citation, PPTSlide, RetrievalMetadata } from '@/types';
import { extractHtmlDocument } from '@/lib/ppt/html-slide-safety';

export interface HtmlDeckSlide {
  title: string;
  layoutHint: string;
  html: string;
  narration?: string;
  outline?: { title: string; points: string[]; layoutHint?: string; part?: string };
}
export interface ImageDeck {
  deckTitle: string;
  slides: PPTSlide[];
  activeIndex: number;
  history: Record<string, string[]>;
  style: string;
  detailLevel: string;
  language: string;
  aspectRatio: string;
  citations: Citation[];
  retrieval: RetrievalMetadata | null;
}
export interface HtmlDeck {
  deckTitle: string;
  slides: HtmlDeckSlide[];
  activeIndex: number;
  styleId: string;
  language: 'zh' | 'en';
  citations: Citation[];
  retrieval: RetrievalMetadata | null;
  qaNotice?: string | null;
}
export interface ImageDeckDocument { runId: string | null; deck: ImageDeck | null }
export interface HtmlDeckDocument { runId: string | null; deck: HtmlDeck | null }
export type PptDeckKind = 'image-deck' | 'html-deck';
export type PptDeckDocument = ImageDeckDocument | HtmlDeckDocument;
export const emptyImageDeck = (): ImageDeckDocument => ({ runId: null, deck: null });
export const emptyHtmlDeck = (): HtmlDeckDocument => ({ runId: null, deck: null });

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(s => typeof s === 'string');
function baseDocument(value: unknown) {
  if (!record(value) || !(value.runId === null || typeof value.runId === 'string' && /^[a-f0-9-]{36}$/i.test(value.runId))) return false;
  if (value.deck === null) return true;
  const deck = value.deck;
  return record(deck) && typeof deck.deckTitle === 'string' && Array.isArray(deck.slides) && deck.slides.length > 0 && deck.slides.length <= 20 &&
    Number.isInteger(deck.activeIndex) && Number(deck.activeIndex) >= 0 && Number(deck.activeIndex) < deck.slides.length && Array.isArray(deck.citations) && deck.citations.every(c => record(c) && typeof c.paperId === 'string' && typeof c.excerpt === 'string') &&
    (deck.retrieval === null || record(deck.retrieval) && typeof deck.retrieval.mode === 'string');
}
export function isImageDeckDocument(value: unknown): value is ImageDeckDocument {
  if (!baseDocument(value)) return false;
  const deck = (value as ImageDeckDocument).deck;
  return deck === null || typeof deck.style === 'string' && typeof deck.detailLevel === 'string' && typeof deck.language === 'string' && ['16:9', '4:3'].includes(deck.aspectRatio) &&
    record(deck.history) && Object.values(deck.history).every(strings) && deck.slides.every(s => record(s) && typeof s.id === 'string' && typeof s.title === 'string' && typeof s.content === 'string' && typeof s.imageUrl === 'string' && s.imageUrl.length > 0 && typeof s.narration === 'string');
}
export function isHtmlDeckDocument(value: unknown): value is HtmlDeckDocument {
  if (!baseDocument(value)) return false;
  const deck = (value as HtmlDeckDocument).deck;
  return deck === null || typeof deck.styleId === 'string' && ['zh', 'en'].includes(deck.language) && deck.slides.every(s => record(s) && typeof s.title === 'string' && typeof s.layoutHint === 'string' && typeof s.html === 'string' && extractHtmlDocument(s.html) === s.html.trim() && (s.narration === undefined || typeof s.narration === 'string'));
}
