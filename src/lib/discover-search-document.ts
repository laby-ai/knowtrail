import type { DiscoveredSourceFileInput } from '@/lib/discovered-source-file';
export type SearchProvider = 'metaso' | 'arxiv' | 'giiisp-paper' | 'dashscope-web' | null;
export interface DiscoverSearchDocument { query: string; optimizedQuery: string; planKeywords: string[]; scope: 'webpage' | 'scholar'; results: DiscoveredSourceFileInput[]; searched: boolean; selected: string[]; provider: SearchProvider }
export const emptyDiscoverSearch = (): DiscoverSearchDocument => ({ query: '', optimizedQuery: '', planKeywords: [], scope: 'scholar', results: [], searched: false, selected: [], provider: null });
export function isDiscoverSearchDocument(value: unknown): value is DiscoverSearchDocument {
  if (!value || typeof value !== 'object') return false;
  const d = value as Partial<DiscoverSearchDocument>;
  return typeof d.query === 'string' && d.query.length <= 1200 && typeof d.optimizedQuery === 'string' && d.optimizedQuery.length <= 4000
    && ['webpage', 'scholar'].includes(d.scope || '') && (d.provider === null || ['metaso', 'arxiv', 'giiisp-paper', 'dashscope-web'].includes(d.provider || ''))
    && typeof d.searched === 'boolean' && Array.isArray(d.planKeywords) && d.planKeywords.length <= 40 && d.planKeywords.every(x => typeof x === 'string')
    && Array.isArray(d.selected) && d.selected.length <= 20 && d.selected.every(x => typeof x === 'string')
    && Array.isArray(d.results) && d.results.length <= 20 && d.results.every(r => r && typeof r.title === 'string' && typeof r.link === 'string' && /^https?:\/\//i.test(r.link) && typeof r.snippet === 'string' && (r.authors === undefined || Array.isArray(r.authors) && r.authors.every(x => typeof x === 'string')));
}
