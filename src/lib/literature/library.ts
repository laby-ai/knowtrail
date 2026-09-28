import { extractDoi, normalizeTitle } from './dedupe';
import type { LiteraturePaper } from './types';

type LiteratureIdentity = Pick<LiteraturePaper, 'doi' | 'arxivId' | 'title' | 'authors' | 'year'>;

function normalizedDoi(paper: LiteratureIdentity): string | undefined {
  return extractDoi(paper.doi?.trim().toLowerCase());
}

function normalizedArxivId(paper: LiteratureIdentity): string | undefined {
  const id = paper.arxivId?.trim().toLowerCase()
    .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//, '')
    .replace(/^arxiv:\s*/, '')
    .replace(/\.pdf$/, '')
    .replace(/v\d+$/, '');
  return id && /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?\/\d{7})$/.test(id) ? id : undefined;
}

function hasIdentifier(paper: LiteratureIdentity): boolean {
  return Boolean(paper.doi?.trim() || paper.arxivId?.trim());
}

/** Empty means there is not enough metadata to safely infer an identity. */
export function literatureIdentityKey(paper: LiteratureIdentity): string {
  const doi = normalizedDoi(paper);
  if (doi) return `doi:${doi}`;
  const arxivId = normalizedArxivId(paper);
  if (arxivId) return `arxiv:${arxivId}`;
  if (hasIdentifier(paper)) return '';

  const title = normalizeTitle(paper.title);
  const authors = paper.authors.map(author => author.name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim());
  const year = String(paper.year).trim();
  if (!title || !authors.length || authors.some(author => !author) || !/^[1-9]\d{3}$/.test(year)) return '';
  return `metadata:${JSON.stringify([title, authors, year])}`;
}

export function sameLiteraturePaper(a: LiteratureIdentity, b: LiteratureIdentity): boolean {
  const aDoi = normalizedDoi(a);
  const bDoi = normalizedDoi(b);
  // Explicit, conflicting DOIs always win over arXiv IDs or similar titles.
  if (aDoi && bDoi) return aDoi === bDoi;
  const aArxiv = normalizedArxivId(a);
  const bArxiv = normalizedArxivId(b);
  if (aArxiv && bArxiv) return aArxiv === bArxiv;
  if (hasIdentifier(a) || hasIdentifier(b)) return false;
  const key = literatureIdentityKey(a);
  return Boolean(key && key === literatureIdentityKey(b));
}

export function literatureEntryKey(paper: LiteraturePaper): string {
  const identity = literatureIdentityKey(paper);
  if (identity) return identity;
  // Exact saved content supports retries without inferring identity from a sparse title.
  return `entry:${JSON.stringify([
    paper.title.trim(), paper.authors.map(author => author.name.trim()), String(paper.year).trim(),
    paper.doi?.trim() || '', paper.arxivId?.trim() || '', paper.url.trim(),
    paper.abstract.trim(), paper.venue,
  ])}`;
}

export function sameLiteratureEntry(a: LiteraturePaper, b: LiteraturePaper): boolean {
  if (sameLiteraturePaper(a, b)) return true;
  if (literatureIdentityKey(a) || literatureIdentityKey(b)) return false;
  return literatureEntryKey(a) === literatureEntryKey(b);
}
