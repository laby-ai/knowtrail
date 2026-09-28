import type { LiteraturePaper, LiteratureProviderId, OALocation } from './types';

function extractDoi(doi: string | undefined): string | undefined {
  if (!doi) return undefined;
  const m = doi.match(/10\.\d{4,}\/[^\s]+/);
  return m ? m[0].replace(/[./]+$/, '') : undefined;
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface DedupBucket {
  key: string;
  papers: LiteraturePaper[];
}

export function deduplicateResults(papers: LiteraturePaper[]): LiteraturePaper[] {
  const doiMap = new Map<string, LiteraturePaper[]>();
  const arxivMap = new Map<string, LiteraturePaper[]>();
  const titleMap = new Map<string, LiteraturePaper[]>();
  const seen = new Set<number>();

  for (let i = 0; i < papers.length; i++) {
    const p = papers[i];
    const doi = extractDoi(p.doi);
    if (doi) {
      const key = doi.toLowerCase();
      if (!doiMap.has(key)) doiMap.set(key, []);
      doiMap.get(key)!.push(p);
    }
    if (p.arxivId) {
      const key = p.arxivId.toLowerCase();
      if (!arxivMap.has(key)) arxivMap.set(key, []);
      arxivMap.get(key)!.push(p);
    }
    const nt = normalizeTitle(p.title);
    if (nt.length > 10) {
      if (!titleMap.has(nt)) titleMap.set(nt, []);
      titleMap.get(nt)!.push(p);
    }
  }

  const groups: DedupBucket[][] = [];

  for (const [, group] of doiMap) {
    if (group.length > 1) groups.push(group.map(p => ({ key: 'doi', papers: [p] })));
  }
  for (const [, group] of arxivMap) {
    if (group.length > 1) groups.push(group.map(p => ({ key: 'arxiv', papers: [p] })));
  }
  for (const [, group] of titleMap) {
    if (group.length > 1) groups.push(group.map(p => ({ key: 'title', papers: [p] })));
  }

  const merged = new Map<number, Set<LiteratureProviderId>>();

  for (const group of groups) {
    const indices: number[] = [];
    for (const item of group) {
      const idx = papers.indexOf(item.papers[0]);
      if (idx >= 0) indices.push(idx);
    }
    if (indices.length > 1) {
      const primary = indices[0];
      for (let i = 1; i < indices.length; i++) {
        seen.add(indices[i]);
        if (!merged.has(primary)) merged.set(primary, new Set());
        merged.get(primary)!.add(papers[indices[i]].source);
      }
    }
  }

  return papers.filter((_, i) => !seen.has(i)).map((p, i) => {
    const extras = merged.get(i);
    if (extras && extras.size > 0) {
      return { ...p };
    }
    return p;
  });
}

export function getAlsoFoundIn(
  paper: LiteraturePaper,
  allPapers: LiteraturePaper[]
): LiteratureProviderId[] {
  const sources: Set<LiteratureProviderId> = new Set();
  const doi = extractDoi(paper.doi);
  const nt = normalizeTitle(paper.title);

  for (const other of allPapers) {
    if (other === paper || other.source === paper.source) continue;
    if (doi && extractDoi(other.doi) === doi) {
      sources.add(other.source);
      continue;
    }
    if (paper.arxivId && other.arxivId === paper.arxivId) {
      sources.add(other.source);
      continue;
    }
    if (nt.length > 10 && normalizeTitle(other.title) === nt) {
      sources.add(other.source);
    }
  }

  return Array.from(sources);
}

export { normalizeTitle, extractDoi };
