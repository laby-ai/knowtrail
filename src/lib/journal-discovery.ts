export interface JournalCandidate { title: string; publisher: string; issn: string[]; matchedWorks: Array<{ title: string; doi: string }>; }
export function groupJournalWorks(input: unknown): JournalCandidate[] {
  if (!input || typeof input !== 'object' || !('message' in input)) throw new Error('期刊元数据格式无效');
  const message = input.message;
  if (!message || typeof message !== 'object' || !('items' in message) || !Array.isArray(message.items)) throw new Error('期刊元数据格式无效');
  const groups = new Map<string, JournalCandidate>();
  for (const raw of message.items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (item.type !== 'journal-article' || !Array.isArray(item['container-title']) || typeof item['container-title'][0] !== 'string' || typeof item.DOI !== 'string') continue;
    const title = item['container-title'][0].trim(); if (!title) continue;
    const group = groups.get(title.toLowerCase()) || { title, publisher: typeof item.publisher === 'string' ? item.publisher : '', issn: Array.isArray(item.ISSN) ? item.ISSN.filter((value): value is string => typeof value === 'string') : [], matchedWorks: [] };
    if (!group.matchedWorks.some(work => work.doi === item.DOI)) group.matchedWorks.push({ title: Array.isArray(item.title) && typeof item.title[0] === 'string' ? item.title[0] : item.DOI, doi: item.DOI });
    groups.set(title.toLowerCase(), group);
  }
  return [...groups.values()].sort((a, b) => b.matchedWorks.length - a.matchedWorks.length).slice(0, 10);
}
