import type { CitationPaper, CitationStyle } from './types';

function formatAuthorsForStyle(authors: { name: string }[], style: CitationStyle): string {
  if (authors.length === 0) return 'Unknown Author';

  switch (style) {
    case 'apa': {
      if (authors.length === 1) return authors[0].name;
      if (authors.length === 2) return `${authors[0].name} & ${authors[1].name}`;
      if (authors.length <= 20) {
        return authors.slice(0, -1).map(a => a.name).join(', ') + ', & ' + authors[authors.length - 1].name;
      }
      return authors.slice(0, 19).map(a => a.name).join(', ') + ', ... ' + authors[authors.length - 1].name;
    }
    case 'mla': {
      if (authors.length === 1) return authors[0].name;
      if (authors.length === 2) return `${authors[0].name}, and ${authors[1].name}`;
      return authors[0].name + ', et al.';
    }
    case 'chicago': {
      if (authors.length === 1) return authors[0].name;
      if (authors.length <= 3) return authors.map(a => a.name).join(', ');
      return authors[0].name + ', et al.';
    }
    case 'ieee': {
      const parts = authors.map((a, i) => {
        const initials = a.name.split(/\s+/).filter(Boolean).map(w => w[0] + '.').join(' ');
        const lastName = a.name.split(/\s+/).filter(Boolean).pop() || a.name;
        return `${initials} ${lastName}`;
      });
      if (parts.length <= 6) return parts.join(', ');
      return parts.slice(0, 6).join(', ') + ', et al.';
    }
    case 'GB/T 7714': {
      if (authors.length <= 3) return authors.map(a => a.name).join(', ');
      return authors.slice(0, 3).map(a => a.name).join(', ') + ', 等';
    }
    case 'bibtex': {
      return authors.map(a => a.name).join(' and ');
    }
  }
}

function bibtexKey(paper: CitationPaper): string {
  const firstAuthor = paper.authors[0]?.name.split(/\s+/).pop() || 'unknown';
  const year = String(paper.year);
  const titleWord = paper.title.split(/\s+/)[0]?.replace(/[^a-zA-Z0-9]/g, '') || 'paper';
  return `${firstAuthor.toLowerCase()}${year}${titleWord.toLowerCase()}`;
}

function bibtexEscape(s: string): string {
  return s.replace(/[&%$#_{}]/g, '\\$&');
}

function formatBibtex(paper: CitationPaper): string {
  const key = bibtexKey(paper);
  const lines = [`@article{${key},`];
  lines.push(`  title = {${bibtexEscape(paper.title)}},`);
  lines.push(`  author = {${formatAuthorsForStyle(paper.authors, 'bibtex')}},`);
  lines.push(`  year = {${paper.year}},`);
  if (paper.venue) lines.push(`  journal = {${bibtexEscape(paper.venue)}},`);
  if (paper.volume) lines.push(`  volume = {${paper.volume}},`);
  if (paper.issue) lines.push(`  number = {${paper.issue}},`);
  if (paper.pages) lines.push(`  pages = {${paper.pages}},`);
  if (paper.doi) lines.push(`  doi = {${paper.doi}},`);
  if (paper.url) lines.push(`  url = {${paper.url}},`);
  lines.push('}');
  return lines.join('\n');
}

function formatApa(paper: CitationPaper): string {
  const authors = formatAuthorsForStyle(paper.authors, 'apa');
  const year = paper.year;
  const title = paper.title;
  const venue = paper.venue;
  let ref = `${authors} (${year}). ${title}.`;
  if (venue) ref += ` *${venue}*`;
  if (paper.volume) {
    ref += `, *${paper.volume}*`;
    if (paper.issue) ref += `(${paper.issue})`;
  }
  if (paper.pages) ref += `, ${paper.pages}`;
  ref += '.';
  if (paper.doi) ref += ` https://doi.org/${paper.doi}`;
  return ref;
}

function formatMla(paper: CitationPaper): string {
  const authors = formatAuthorsForStyle(paper.authors, 'mla');
  const title = paper.title;
  const venue = paper.venue;
  let ref = `${authors}. "${title}."`;
  if (venue) ref += ` *${venue}*`;
  if (paper.volume) ref += `, vol. ${paper.volume}`;
  if (paper.issue) ref += `, no. ${paper.issue}`;
  ref += `, ${paper.year}`;
  if (paper.pages) ref += `, pp. ${paper.pages}`;
  ref += '.';
  return ref;
}

function formatChicago(paper: CitationPaper): string {
  const authors = formatAuthorsForStyle(paper.authors, 'chicago');
  const title = paper.title;
  const venue = paper.venue;
  let ref = `${authors}. "${title}."`;
  if (venue) ref += ` *${venue}*`;
  if (paper.volume) ref += ` ${paper.volume}`;
  if (paper.issue) ref += `, no. ${paper.issue}`;
  ref += ` (${paper.year})`;
  if (paper.pages) ref += `: ${paper.pages}`;
  ref += '.';
  return ref;
}

function formatIeee(paper: CitationPaper): string {
  const authors = formatAuthorsForStyle(paper.authors, 'ieee');
  const title = paper.title;
  const venue = paper.venue;
  let ref = `${authors}, "${title},"`;
  if (venue) ref += ` *${venue}*`;
  if (paper.volume) ref += `, vol. ${paper.volume}`;
  if (paper.issue) ref += `, no. ${paper.issue}`;
  if (paper.pages) ref += `, pp. ${paper.pages}`;
  ref += `, ${paper.year}.`;
  return ref;
}

function formatGbt7714(paper: CitationPaper): string {
  const authors = formatAuthorsForStyle(paper.authors, 'GB/T 7714');
  const title = paper.title;
  const venue = paper.venue;
  let ref = `${authors}. ${title}[J].`;
  if (venue) ref += ` ${venue},`;
  ref += ` ${paper.year}`;
  if (paper.volume) ref += `, ${paper.volume}`;
  if (paper.issue) ref += `(${paper.issue})`;
  if (paper.pages) ref += `: ${paper.pages}`;
  ref += '.';
  if (paper.doi) ref += ` DOI:${paper.doi}.`;
  return ref;
}

export function formatCitation(paper: CitationPaper, style: CitationStyle): string {
  switch (style) {
    case 'bibtex': return formatBibtex(paper);
    case 'apa': return formatApa(paper);
    case 'mla': return formatMla(paper);
    case 'chicago': return formatChicago(paper);
    case 'ieee': return formatIeee(paper);
    case 'GB/T 7714': return formatGbt7714(paper);
  }
}

export function formatBibliography(papers: CitationPaper[], style: CitationStyle): string {
  return papers.map((p, i) => {
    const citation = formatCitation(p, style);
    if (style === 'bibtex') return citation;
    if (style === 'ieee') return `[${i + 1}] ${citation}`;
    return citation;
  }).join('\n\n');
}

export function exportBibliographyFile(papers: CitationPaper[], style: CitationStyle): string {
  if (style === 'bibtex') {
    return formatBibliography(papers, 'bibtex');
  }
  return formatBibliography(papers, style);
}
