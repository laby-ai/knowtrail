// Plain-JS mirror of src/lib/literature/providers.ts for MCP subprocess

function extractDoiFromUrl(url) {
  if (!url) return undefined;
  const m = url.match(/doi\.org\/(10\.\d{4,}\/[^\s?#]+)/);
  return m ? m[1] : undefined;
}

function parseAuthorString(s) {
  return s.split(/\s*[,;]\s*/).filter(Boolean).map(name => ({ name: name.trim() }));
}

async function fetchJson(url, headers) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

async function searchCrossref(query, limit) {
  const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${limit}&select=DOI,title,author,published-print,published-online,container-title,abstract,URL`;
  const data = await fetchJson(url);
  return data.message.items.map(item => {
    const pub = item['published-online'] || item['published-print'];
    const year = pub?.['date-parts']?.[0]?.[0] || new Date().getFullYear();
    const authors = (item.author || []).map(a => ({ name: a.name || `${a.given || ''} ${a.family || ''}`.trim() }));
    return {
      title: (item.title?.[0] || '').trim(),
      authors, year, doi: item.DOI,
      abstract: (item.abstract || '').replace(/<[^>]+>/g, ''),
      venue: item['container-title']?.[0] || '',
      url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : ''),
      source: 'crossref', provider: 'Crossref', evidenceScope: 'abstract',
    };
  }).filter(p => p.title);
}

async function searchEuropePmc(query, limit) {
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&pageSize=${limit}&format=json&resultType=core`;
  const data = await fetchJson(url);
  return data.resultList.result.map(item => {
    const authors = item.authorList?.author?.map(a => ({ name: a.fullName || '' })) || parseAuthorString(item.authorString || '');
    const oaLocations = [];
    if (item.fullTextUrlList?.fullTextUrl) {
      for (const ftu of item.fullTextUrlList.fullTextUrl) {
        if (ftu.documentStyle === 'pdf' && ftu.availabilityCode === 'Open access') {
          oaLocations.push({ url: ftu.url, pdfUrl: ftu.url, source: 'europepmc', license: ftu.license });
        }
      }
    }
    return {
      title: (item.title || '').replace(/\.$/, ''), authors,
      year: Number(item.pubYear) || new Date().getFullYear(),
      doi: item.doi || undefined,
      abstract: item.abstractText || '',
      venue: item.journalTitle || '',
      url: item.doi ? `https://doi.org/${item.doi}` : `https://europepmc.org/article/${item.source || 'MED'}/${item.id || item.pmid || ''}`,
      source: 'europepmc', provider: 'Europe PMC', evidenceScope: 'abstract',
      ...(oaLocations.length > 0 ? { oaLocations } : {}),
    };
  }).filter(p => p.title);
}

async function searchSemanticScholar(query, limit) {
  const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  const headers = {};
  if (apiKey) headers['x-api-key'] = apiKey;
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=title,authors,year,abstract,venue,externalIds,url,openAccessPdf`;
  const data = await fetchJson(url, headers);
  return (data.data || []).map(item => {
    const oaLocations = [];
    if (item.openAccessPdf?.url) {
      oaLocations.push({ url: item.openAccessPdf.url, pdfUrl: item.openAccessPdf.url, source: 'semantic-scholar' });
    }
    return {
      title: (item.title || '').trim(), authors: item.authors || [],
      year: item.year || new Date().getFullYear(),
      doi: item.externalIds?.DOI, arxivId: item.externalIds?.ArXiv,
      abstract: item.abstract || '', venue: item.venue || '',
      url: item.url || (item.externalIds?.DOI ? `https://doi.org/${item.externalIds.DOI}` : ''),
      source: 'semantic-scholar', provider: 'Semantic Scholar', evidenceScope: 'abstract',
      ...(oaLocations.length > 0 ? { oaLocations } : {}),
    };
  }).filter(p => p.title);
}

async function searchOpenAlex(query, limit) {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=${limit}`;
  const data = await fetchJson(url);
  return data.results.map(item => {
    const authors = (item.authorships || []).map(a => ({ name: a.author.display_name }));
    let abstract = '';
    if (item.abstract_inverted_index) {
      const words = [];
      for (const [word, positions] of Object.entries(item.abstract_inverted_index)) {
        for (const pos of positions) words.push([word, pos]);
      }
      words.sort((a, b) => a[1] - b[1]);
      abstract = words.map(w => w[0]).join(' ');
    }
    const oaLocations = [];
    if (item.best_oa_location?.pdf_url) {
      oaLocations.push({ url: item.best_oa_location.landing_page_url || item.best_oa_location.pdf_url, pdfUrl: item.best_oa_location.pdf_url, source: 'openalex' });
    }
    const doiClean = item.doi ? item.doi.replace(/^https?:\/\/doi\.org\//, '') : undefined;
    return {
      title: (item.title || '').trim(), authors,
      year: item.publication_year || new Date().getFullYear(),
      doi: doiClean, abstract,
      venue: item.primary_location?.source?.display_name || '',
      url: item.doi || item.id || '',
      source: 'openalex', provider: 'OpenAlex',
      evidenceScope: abstract ? 'abstract' : 'metadata',
      ...(oaLocations.length > 0 ? { oaLocations } : {}),
    };
  }).filter(p => p.title);
}

async function searchArxiv(query, limit) {
  const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${limit}`;
  const xml = await fetchText(url);
  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, ' ').trim() || '';
    const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, ' ').trim() || '';
    const published = entry.match(/<published>(\d{4})/)?.[1] || String(new Date().getFullYear());
    const arxivIdUrl = entry.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() || '';
    const arxivId = arxivIdUrl.split('/abs/').pop() || '';
    const doiLink = entry.match(/<link[^>]*title="doi"[^>]*href="([^"]+)"/);
    const doi = doiLink ? extractDoiFromUrl(doiLink[1]) : undefined;
    const authors = [];
    const authorRegex = /<name>([\s\S]*?)<\/name>/g;
    let authorMatch;
    while ((authorMatch = authorRegex.exec(entry)) !== null) {
      authors.push({ name: authorMatch[1].trim() });
    }
    const journalRef = entry.match(/<arxiv:journal_ref[^>]*>([\s\S]*?)<\/arxiv:journal_ref>/);
    const venue = journalRef?.[1]?.trim() || 'arXiv';
    if (title) {
      entries.push({ title, authors, year: Number(published), doi, arxivId, abstract: summary, venue, url: arxivIdUrl || `https://arxiv.org/abs/${arxivId}`, source: 'arxiv', provider: 'arXiv', evidenceScope: 'abstract' });
    }
  }
  return entries;
}

async function searchPubmed(query, limit) {
  const apiKey = process.env.NCBI_API_KEY;
  const keyParam = apiKey ? `&api_key=${apiKey}` : '';
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${limit}&retmode=json${keyParam}`;
  const searchData = await fetchJson(searchUrl);
  const ids = searchData.esearchresult?.idlist || [];
  if (ids.length === 0) return [];
  const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json${keyParam}`;
  const summaryData = await fetchJson(summaryUrl);
  return ids.map(id => {
    const item = summaryData.result[id];
    if (!item) return null;
    const doi = item.elocationid?.startsWith('10.') ? item.elocationid : undefined;
    return {
      title: (item.title || '').trim(),
      authors: (item.authors || []).map(a => ({ name: a.name || '' })),
      year: Number(item.pubdate?.slice(0, 4)) || new Date().getFullYear(),
      doi, abstract: '', venue: item.source || '',
      url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      source: 'pubmed', provider: 'PubMed', evidenceScope: 'metadata',
    };
  }).filter(p => p && p.title);
}

async function searchScite(query, limit) {
  const apiKey = process.env.SCITE_API_KEY;
  if (!apiKey) return [];
  const url = `https://api.scite.ai/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  const data = await fetchJson(url, { Authorization: `Bearer ${apiKey}` });
  return (data.citations || []).map(item => ({
    title: (item.title || '').trim(),
    authors: parseAuthorString(item.authors || ''),
    year: item.year || new Date().getFullYear(),
    doi: item.doi || undefined,
    abstract: item.abstract || '', venue: item.journalName || '',
    url: item.url || (item.doi ? `https://doi.org/${item.doi}` : ''),
    source: 'scite', provider: 'Scite', evidenceScope: 'abstract',
  })).filter(p => p.title);
}

export function searchLiterature(source, query, limit) {
  switch (source) {
    case 'crossref': return searchCrossref(query, limit);
    case 'europepmc': return searchEuropePmc(query, limit);
    case 'semantic-scholar': return searchSemanticScholar(query, limit);
    case 'openalex': return searchOpenAlex(query, limit);
    case 'arxiv': return searchArxiv(query, limit);
    case 'pubmed': return searchPubmed(query, limit);
    case 'scite': return searchScite(query, limit);
    default: throw new Error(`Unknown source: ${source}`);
  }
}

export const SOURCE_DISPLAY_NAMES = {
  crossref: 'Crossref',
  europepmc: 'Europe PMC',
  'semantic-scholar': 'Semantic Scholar',
  openalex: 'OpenAlex',
  arxiv: 'arXiv',
  pubmed: 'PubMed',
  scite: 'Scite',
};
