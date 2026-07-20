import type { WorkspaceNotebook } from '@/components/home/workspace-types';

export type NotebookHomeFilter = 'all' | 'mine' | 'featured';
export type NotebookHomeSort = 'latest' | 'oldest' | 'title';
export type NotebookHomeView = 'comfortable' | 'grid' | 'list';

export function projectNotebookHome({
  notebooks,
  query,
  filter,
  sort,
  view,
}: {
  notebooks: WorkspaceNotebook[];
  query: string;
  filter: NotebookHomeFilter;
  sort: NotebookHomeSort;
  view: NotebookHomeView;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const visible = notebooks
    .filter(notebook => notebook.title.toLowerCase().includes(normalizedQuery))
    .toSorted((left, right) => {
      if (sort === 'title') return left.title.localeCompare(right.title, 'zh-CN');
      const delta = Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
      return sort === 'oldest' ? delta : -delta;
    });

  return {
    notebooks: visible,
    showFeatured: filter !== 'mine',
    showPersonal: filter !== 'featured',
    view,
  };
}
