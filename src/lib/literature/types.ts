export type LiteratureProviderId =
  | 'crossref'
  | 'europepmc'
  | 'semantic-scholar'
  | 'openalex'
  | 'arxiv'
  | 'pubmed'
  | 'scite';

export const LITERATURE_PROVIDER_IDS: readonly LiteratureProviderId[] = [
  'crossref',
  'europepmc',
  'semantic-scholar',
  'openalex',
  'arxiv',
  'pubmed',
  'scite',
];

export interface OALocation {
  url: string;
  pdfUrl?: string;
  source: string;
  license?: string;
}

export interface LiteraturePaper {
  title: string;
  authors: { name: string }[];
  year: number | string;
  doi?: string;
  arxivId?: string;
  abstract: string;
  venue: string;
  url: string;
  source: LiteratureProviderId;
  provider: string;
  evidenceScope: 'abstract' | 'metadata' | 'fulltext';
  oaLocations?: OALocation[];
  fullText?: string;
}

export interface LiteratureMetadata extends Omit<LiteraturePaper, 'fullText'> {
  retrievedAt: string;
}

export interface LiteratureResult extends LiteraturePaper {
  resultId: string;
  retrievedAt: string;
  alsoFoundIn: LiteratureProviderId[];
}

export interface FullTextResult {
  fullText: string;
  pdfUrl: string;
  source: 'unpaywall' | 'direct' | 'oa';
  charCount: number;
}

export type FullTextFailureCode =
  | 'no_oa'
  | 'network_error'
  | 'extraction_failed'
  | 'no_identifier'
  | 'unsafe_url'
  | 'too_large';

export type LiteratureFullTextStatus =
  | { status: 'downloaded' | 'existing'; charCount?: number }
  | { status: 'partial'; code: FullTextFailureCode; message: string };

export interface LiteratureImportFeedback {
  literature: LiteratureMetadata;
  fullText: LiteratureFullTextStatus;
}

export type CitationStyle = 'bibtex' | 'apa' | 'mla' | 'chicago' | 'ieee' | 'GB/T 7714';

export interface CitationPaper {
  title: string;
  authors: { name: string }[];
  year: number | string;
  doi?: string;
  arxivId?: string;
  venue?: string;
  url?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
}
