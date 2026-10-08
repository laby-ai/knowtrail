import type { CitationStyle, LiteratureProviderId } from './literature/types';

export type ResearchDisciplineId = 'biomedicine' | 'materials-chemistry' | 'computer-science' | 'social-sciences';
export type ResearchPreferences = { disciplines: ResearchDisciplineId[]; researchMode: boolean };
export const RESEARCH_DISCIPLINES: ReadonlyArray<{ id: ResearchDisciplineId; label: string; color: string; sources: LiteratureProviderId[]; citationStyle: CitationStyle }> = [
  { id: 'biomedicine', label: '生物医学', color: '#087f8c', sources: ['pubmed', 'europepmc'], citationStyle: 'vancouver' },
  { id: 'materials-chemistry', label: '材料化学', color: '#b65d18', sources: ['crossref', 'openalex'], citationStyle: 'GB/T 7714' },
  { id: 'computer-science', label: '计算机科学', color: '#6355b8', sources: ['arxiv', 'semantic-scholar'], citationStyle: 'ieee' },
  { id: 'social-sciences', label: '社会科学', color: '#357451', sources: ['crossref', 'openalex'], citationStyle: 'apa' },
];
export const DEFAULT_RESEARCH_PREFERENCES: ResearchPreferences = { disciplines: [], researchMode: true };
export function parseResearchPreferences(value: unknown): ResearchPreferences {
  if (!value || typeof value !== 'object') throw new Error('科研偏好格式不正确。');
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.disciplines) || raw.disciplines.length > 4 || typeof raw.researchMode !== 'boolean') throw new Error('请选择研究领域及科研模式。');
  const valid = new Set(RESEARCH_DISCIPLINES.map(item => item.id));
  if (!raw.disciplines.every(id => typeof id === 'string' && valid.has(id as ResearchDisciplineId))) throw new Error('研究领域不支持。');
  return { disciplines: [...new Set(raw.disciplines)] as ResearchDisciplineId[], researchMode: raw.researchMode };
}
