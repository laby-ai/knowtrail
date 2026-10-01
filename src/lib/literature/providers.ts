import type { LiteraturePaper, LiteratureProviderId, OALocation } from './types';

function extractDoiFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const m = url.match(/doi\.org\/(10\.\d{4,}\/[^\s?#]+)/);
  return m ? m[1] : undefined;
}

function parseAuthorString(s: string): { name: string }[] {
  return s.split(/\s*[,;]\s*/).filter(Boolean).map(name => ({ name: name.trim() }));
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

// ─── Crossref ───────────────────────────────────────────────

async function searchCrossref(query: string, limit: number): Promise<LiteraturePaper[]> {
  const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${limit}&select=DOI,title,author,published-print,published-online,container-title,abstract,URL`;
  const data = await fetchJson(url) as {
    message: { items: Array<{
      DOI?: string;
      title?: string[];
      author?: Array<{ given?: string; family?: string; name?: string }>;
      'published-print'?: { 'date-parts'?: number[][] };
      'published-online'?: { 'date-parts'?: number[][] };
      'container-title'?: string[];
      abstract?: string;
      URL?: string;
    }>; };
  };

  return data.message.items.map(item => {
    const pub = item['published-online'] || item['published-print'];
    const year = pub?.['date-parts']?.[0]?.[0] || '';
    const authors = (item.author || []).map(a =>
      ({ name: a.name || `${a.given || ''} ${a.family || ''}`.trim() })
    );
    return {
      title: (item.title?.[0] || '').trim(),
      authors,
      year,
      doi: item.DOI,
      abstract: (item.abstract || '').replace(/<[^>]+>/g, ''),
      venue: item['container-title']?.[0] || '',
      url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : ''),
      source: 'crossref' as LiteratureProviderId,
      provider: 'Crossref',
      evidenceScope: 'abstract' as const,
    };
  }).filter(p => p.title);
}

// ─── Europe PMC ─────────────────────────────────────────────

async function searchEuropePmc(query: string, limit: number): Promise<LiteraturePaper[]> {
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&pageSize=${limit}&format=json&resultType=core`;
  const data = await fetchJson(url) as {
    resultList: { result: Array<{
      doi?: string;
      title?: string;
      authorString?: string;
      authorList?: { author: Array<{ fullName?: string }> };
      pubYear?: string | number;
      abstractText?: string;
      journalTitle?: string;
      pmid?: string;
      pmcid?: string;
      fullTextUrlList?: { fullTextUrl: Array<{ url: string; documentStyle?: string; availabilityCode?: string; license?: string }> };
      id?: string;
      source?: string;
    }>; };
  };

  return data.resultList.result.map(item => {
    const authors = item.authorList?.author?.map(a => ({ name: a.fullName || '' })) ||
      parseAuthorString(item.authorString || '');

    const oaLocations: OALocation[] = [];
    if (item.fullTextUrlList?.fullTextUrl) {
      for (const ftu of item.fullTextUrlList.fullTextUrl) {
        if (ftu.documentStyle === 'pdf' && ftu.availabilityCode === 'Open access') {
          oaLocations.push({
            url: ftu.url,
            pdfUrl: ftu.url,
            source: 'europepmc',
            license: ftu.license,
          });
        }
      }
    }

    return {
      title: (item.title || '').replace(/\.$/, ''),
      authors,
      year: Number(item.pubYear) || '',
      doi: item.doi || undefined,
      abstract: item.abstractText || '',
      venue: item.journalTitle || '',
      url: item.doi ? `https://doi.org/${item.doi}` : `https://europepmc.org/article/${item.source || 'MED'}/${item.id || item.pmid || ''}`,
      source: 'europepmc' as LiteratureProviderId,
      provider: 'Europe PMC',
      evidenceScope: 'abstract' as const,
      oaLocations: oaLocations.length > 0 ? oaLocations : undefined,
    };
  }).filter(p => p.title);
}

// ─── Semantic Scholar ───────────────────────────────────────

async function searchSemanticScholar(query: string, limit: number): Promise<LiteraturePaper[]> {
  const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  const headers: Record<string, string> = {};
  if (apiKey) headers['x-api-key'] = apiKey;

  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=title,authors,year,abstract,venue,externalIds,url,openAccessPdf`;
  const data = await fetchJson(url, headers) as {
    data: Array<{
      title?: string;
      authors?: Array<{ name: string }>;
      year?: number;
      abstract?: string;
      venue?: string;
      externalIds?: { DOI?: string; ArXiv?: string };
      url?: string;
      openAccessPdf?: { url: string } | null;
    }>;
  };

  return (data.data || []).map(item => {
    const oaLocations: OALocation[] = [];
    if (item.openAccessPdf?.url) {
      oaLocations.push({
        url: item.openAccessPdf.url,
        pdfUrl: item.openAccessPdf.url,
        source: 'semantic-scholar',
      });
    }

    return {
      title: (item.title || '').trim(),
      authors: item.authors || [],
      year: item.year || '',
      doi: item.externalIds?.DOI,
      arxivId: item.externalIds?.ArXiv,
      abstract: item.abstract || '',
      venue: item.venue || '',
      url: item.url || (item.externalIds?.DOI ? `https://doi.org/${item.externalIds.DOI}` : ''),
      source: 'semantic-scholar' as LiteratureProviderId,
      provider: 'Semantic Scholar',
      evidenceScope: 'abstract' as const,
      oaLocations: oaLocations.length > 0 ? oaLocations : undefined,
    };
  }).filter(p => p.title);
}

// ─── OpenAlex ───────────────────────────────────────────────

async function searchOpenAlex(query: string, limit: number): Promise<LiteraturePaper[]> {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=${limit}`;
  const data = await fetchJson(url) as {
    results: Array<{
      title?: string;
      authorships?: Array<{ author: { display_name: string } }>;
      publication_year?: number;
      doi?: string;
      abstract_inverted_index?: Record<string, number[]>;
      primary_location?: { source?: { display_name?: string } };
      best_oa_location?: { pdf_url?: string; landing_page_url?: string };
      id?: string;
    }>;
  };

  return data.results.map(item => {
    const authors = (item.authorships || []).map(a => ({ name: a.author.display_name }));

    let abstract = '';
    if (item.abstract_inverted_index) {
      const words: [string, number][] = [];
      for (const [word, positions] of Object.entries(item.abstract_inverted_index)) {
        for (const pos of positions) words.push([word, pos]);
      }
      words.sort((a, b) => a[1] - b[1]);
      abstract = words.map(w => w[0]).join(' ');
    }

    const oaLocations: OALocation[] = [];
    if (item.best_oa_location?.pdf_url) {
      oaLocations.push({
        url: item.best_oa_location.landing_page_url || item.best_oa_location.pdf_url,
        pdfUrl: item.best_oa_location.pdf_url,
        source: 'openalex',
      });
    } else if (item.best_oa_location?.landing_page_url) {
      oaLocations.push({
        url: item.best_oa_location.landing_page_url,
        source: 'openalex',
      });
    }

    const doiClean = item.doi ? item.doi.replace(/^https?:\/\/doi\.org\//, '') : undefined;

    return {
      title: (item.title || '').trim(),
      authors,
      year: item.publication_year || '',
      doi: doiClean,
      abstract,
      venue: item.primary_location?.source?.display_name || '',
      url: item.doi || item.id || '',
      source: 'openalex' as LiteratureProviderId,
      provider: 'OpenAlex',
      evidenceScope: abstract ? 'abstract' as const : 'metadata' as const,
      oaLocations: oaLocations.length > 0 ? oaLocations : undefined,
    };
  }).filter(p => p.title);
}

// ─── arXiv ──────────────────────────────────────────────────

async function searchArxiv(query: string, limit: number): Promise<LiteraturePaper[]> {
  const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${limit}`;
  const xml = await fetchText(url);

  const entries: LiteraturePaper[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];

    const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, ' ').trim() || '';
    const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, ' ').trim() || '';
    const published = entry.match(/<published>(\d{4})/)?.[1] || '';
    const arxivIdUrl = entry.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() || '';
    const arxivId = arxivIdUrl.split('/abs/').pop() || '';

    const doiLink = entry.match(/<link[^>]*title="doi"[^>]*href="([^"]+)"/);
    const doi = doiLink ? extractDoiFromUrl(doiLink[1]) : undefined;

    const authors: { name: string }[] = [];
    const authorRegex = /<name>([\s\S]*?)<\/name>/g;
    let authorMatch;
    while ((authorMatch = authorRegex.exec(entry)) !== null) {
      authors.push({ name: authorMatch[1].trim() });
    }

    const journalRef = entry.match(/<arxiv:journal_ref[^>]*>([\s\S]*?)<\/arxiv:journal_ref>/);
    const venue = journalRef?.[1]?.trim() || 'arXiv';

    if (title) {
      entries.push({
        title,
        authors,
        year: Number(published) || '',
        doi,
        arxivId,
        abstract: summary,
        venue,
        url: arxivIdUrl || `https://arxiv.org/abs/${arxivId}`,
        source: 'arxiv',
        provider: 'arXiv',
        evidenceScope: 'abstract',
      });
    }
  }

  return entries;
}

// ─── PubMed ─────────────────────────────────────────────────

async function searchPubmed(query: string, limit: number): Promise<LiteraturePaper[]> {
  const apiKey = process.env.NCBI_API_KEY;
  const keyParam = apiKey ? `&api_key=${apiKey}` : '';
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${limit}&retmode=json${keyParam}`;
  const searchData = await fetchJson(searchUrl) as {
    esearchresult: { idlist: string[] };
  };

  const ids = searchData.esearchresult?.idlist || [];
  if (ids.length === 0) return [];

  const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json${keyParam}`;
  const summaryData = await fetchJson(summaryUrl) as {
    result: Record<string, {
      title?: string;
      authors?: Array<{ name?: string }>;
      pubdate?: string;
      source?: string;
      elocationid?: string;
      volume?: string;
      issue?: string;
      pages?: string;
    }>;
  };

  return ids.map(id => {
    const item = summaryData.result[id];
    if (!item) return null;

    const doi = item.elocationid?.startsWith('10.') ? item.elocationid : undefined;

    return {
      title: (item.title || '').trim(),
      authors: (item.authors || []).map(a => ({ name: a.name || '' })),
      year: Number(item.pubdate?.slice(0, 4)) || '',
      doi,
      abstract: '',
      venue: item.source || '',
      url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      source: 'pubmed' as LiteratureProviderId,
      provider: 'PubMed',
      evidenceScope: 'metadata' as const,
    };
  }).filter(p => p !== null && p.title !== '') as LiteraturePaper[];
}

// ─── Scite ──────────────────────────────────────────────────

async function searchScite(query: string, limit: number): Promise<LiteraturePaper[]> {
  const apiKey = process.env.SCITE_API_KEY;
  if (!apiKey) return [];

  const url = `https://api.scite.ai/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  const data = await fetchJson(url, { Authorization: `Bearer ${apiKey}` }) as {
    citations?: Array<{
      title?: string;
      authors?: string;
      doi?: string;
      abstract?: string;
      journalName?: string;
      year?: number;
      url?: string;
    }>;
  };

  return (data.citations || []).map(item => ({
    title: (item.title || '').trim(),
    authors: parseAuthorString(item.authors || ''),
    year: item.year || '',
    doi: item.doi || undefined,
    abstract: item.abstract || '',
    venue: item.journalName || '',
    url: item.url || (item.doi ? `https://doi.org/${item.doi}` : ''),
    source: 'scite' as LiteratureProviderId,
    provider: 'Scite',
    evidenceScope: 'abstract' as const,
  })).filter(p => p.title);
}

// ─── Dispatch ───────────────────────────────────────────────

export function searchLiterature(
  source: LiteratureProviderId,
  query: string,
  limit: number
): Promise<LiteraturePaper[]> {
  switch (source) {
    case 'crossref': return searchCrossref(query, limit);
    case 'europepmc': return searchEuropePmc(query, limit);
    case 'semantic-scholar': return searchSemanticScholar(query, limit);
    case 'openalex': return searchOpenAlex(query, limit);
    case 'arxiv': return searchArxiv(query, limit);
    case 'pubmed': return searchPubmed(query, limit);
    case 'scite': return searchScite(query, limit);
  }
}

export const SOURCE_DISPLAY_NAMES: Record<LiteratureProviderId, string> = {
  crossref: 'Crossref',
  europepmc: 'Europe PMC',
  'semantic-scholar': 'Semantic Scholar',
  openalex: 'OpenAlex',
  arxiv: 'arXiv',
  pubmed: 'PubMed',
  scite: 'Scite',
};
