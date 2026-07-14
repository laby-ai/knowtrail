import type { WorkspaceNotebook } from '@/components/home/workspace-types';

type SourceCountMap = Record<string, number>;

export async function loadNotebookSourceCounts({
  notebookIds,
  headers,
  request = fetch,
}: {
  notebookIds: string[];
  headers?: HeadersInit;
  request?: typeof fetch;
}): Promise<SourceCountMap> {
  const uniqueNotebookIds = [...new Set(notebookIds.filter(Boolean))];
  const entries = await Promise.all(uniqueNotebookIds.map(async notebookId => {
    try {
      const params = new URLSearchParams({ notebookId });
      const response = await request(`/api/ingestion/sources?${params.toString()}`, {
        cache: 'no-store',
        headers,
      });
      if (!response.ok) return null;
      const payload = await response.json() as { sources?: unknown[] };
      return [notebookId, Array.isArray(payload.sources) ? payload.sources.length : 0] as const;
    } catch {
      return null;
    }
  }));

  return Object.fromEntries(entries.filter((entry): entry is readonly [string, number] => entry !== null));
}

export function mergeNotebookSourceCounts({
  notebooks,
  persistedCounts,
  builtInCounts = {},
}: {
  notebooks: WorkspaceNotebook[];
  persistedCounts: SourceCountMap;
  builtInCounts?: SourceCountMap;
}): WorkspaceNotebook[] {
  return notebooks.map(notebook => {
    if (!Object.prototype.hasOwnProperty.call(persistedCounts, notebook.id)) return notebook;
    return {
      ...notebook,
      sourceCount: (builtInCounts[notebook.id] || 0) + persistedCounts[notebook.id],
    };
  });
}
