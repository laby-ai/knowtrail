import type { LiteratureProviderId } from '../literature/types';

const LITERATURE_TOOLS: Record<LiteratureProviderId, string> = {
  crossref: 'search_crossref',
  europepmc: 'search_europepmc',
  'semantic-scholar': 'search_semantic_scholar',
  openalex: 'search_openalex',
  arxiv: 'search_arxiv',
  pubmed: 'search_pubmed',
  scite: 'search_scite',
};

export function getLiteratureToolName(providerId: LiteratureProviderId): string {
  return LITERATURE_TOOLS[providerId];
}

export function getAllLiteratureTools(): { providerId: LiteratureProviderId; toolName: string }[] {
  return Object.entries(LITERATURE_TOOLS).map(([providerId, toolName]) => ({
    providerId: providerId as LiteratureProviderId,
    toolName,
  }));
}

export function sanitizedSubprocessEnv(): Record<string, string> {
  const allowed = [
    'SEMANTIC_SCHOLAR_API_KEY',
    'NCBI_API_KEY',
    'SCITE_API_KEY',
    'UNPAYWALL_EMAIL',
    'LITERATURE_HMAC_SECRET',
  ];

  const env: Record<string, string> = {};
  const regex = new RegExp(`^(${allowed.join('|')})$`);

  for (const [key, value] of Object.entries(process.env)) {
    if (regex.test(key) && value) {
      env[key] = value;
    }
  }

  return env;
}
