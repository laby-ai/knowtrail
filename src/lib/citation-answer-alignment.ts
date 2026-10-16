import type { Citation } from '@/types';

const GENERIC_SOURCE_WORDS = /(?:摘录|笔记|资料|文献|来源|论文|记录)$/u;
const CONTEXT_BOUNDARY = /[。！？；;]/u;

export function alignCitationsToAnswerMarkers<T extends Citation>(answer: string, citations: T[]): T[] {
  if (citations.length < 2) return citations;

  const markerContexts = citations.map((_, index) => contextForMarker(answer, index + 1));
  if (markerContexts.some(context => !context)) return citations;

  const remaining = new Set(citations.map((_, index) => index));
  const aligned: T[] = [];

  for (const context of markerContexts) {
    const ranked = [...remaining]
      .map(index => ({ index, score: identityScore(context, citations[index]) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const runnerUp = ranked[1];
    if (!best || best.score <= 0 || (runnerUp && runnerUp.score === best.score)) return citations;
    aligned.push(citations[best.index]);
    remaining.delete(best.index);
  }

  return aligned;
}

function contextForMarker(answer: string, markerNumber: number): string {
  const marker = `[${markerNumber}]`;
  const contexts: string[] = [];
  let searchFrom = 0;

  while (searchFrom < answer.length) {
    const markerIndex = answer.indexOf(marker, searchFrom);
    if (markerIndex < 0) break;
    const windowStart = Math.max(0, markerIndex - 260);
    const window = answer.slice(windowStart, markerIndex);
    const headingMatches = [...window.matchAll(/\*\*[^*\n]{2,80}\*\*\s*[:：]?\s*/gu)];
    const lastHeading = headingMatches[headingMatches.length - 1];
    if (lastHeading?.index !== undefined) {
      contexts.push(window.slice(lastHeading.index));
      searchFrom = markerIndex + marker.length;
      continue;
    }
    const paragraphBoundary = window.lastIndexOf('\n\n');
    if (paragraphBoundary >= 0) {
      contexts.push(window.slice(paragraphBoundary + 2));
      searchFrom = markerIndex + marker.length;
      continue;
    }
    let boundary = -1;
    for (let index = window.length - 1; index >= 0; index -= 1) {
      if (CONTEXT_BOUNDARY.test(window[index])) {
        boundary = index;
        break;
      }
    }
    contexts.push(window.slice(boundary + 1));
    searchFrom = markerIndex + marker.length;
  }

  return normalize(contexts.join(' '));
}

function identityScore(context: string, citation: Citation): number {
  return identityTerms(citation).reduce(
    (score, term) => score + (context.includes(term) ? term.length : 0),
    0,
  );
}

function identityTerms(citation: Citation): string[] {
  const terms = new Set<string>();
  for (const value of [citation.sourceTitle, citation.paperShortName]) {
    const normalized = normalize(value || '').replace(/\d{4}/gu, '').replace(GENERIC_SOURCE_WORDS, '');
    if (normalized.length >= 2) terms.add(normalized);
    for (const part of normalized.split(/[与和及、·\-_/（）()\s]+/u)) {
      if (part.length >= 2) terms.add(part.replace(GENERIC_SOURCE_WORDS, ''));
    }
  }
  return [...terms].filter(term => term.length >= 2);
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s：:，,。！？；;“”"'`]/gu, '');
}
