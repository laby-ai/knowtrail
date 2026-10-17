import type { WorkspaceNotebook } from '@/components/home/workspace-types';

export function visibleNotebooks(notebooks: WorkspaceNotebook[]): WorkspaceNotebook[] {
  return notebooks.filter(notebook => !notebook.archivedAt);
}

export function archivedNotebooks(notebooks: WorkspaceNotebook[]): WorkspaceNotebook[] {
  return notebooks.filter(notebook => Boolean(notebook.archivedAt));
}

export function renameNotebook(
  notebooks: WorkspaceNotebook[],
  id: string,
  rawTitle: string,
  updatedAt = new Date().toISOString(),
): WorkspaceNotebook[] {
  const title = rawTitle.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!title) return notebooks;
  return notebooks.map(notebook => notebook.id === id ? { ...notebook, title, updatedAt } : notebook);
}

export function archiveNotebook(
  notebooks: WorkspaceNotebook[],
  id: string,
  archivedAt = new Date().toISOString(),
): WorkspaceNotebook[] {
  if (visibleNotebooks(notebooks).length <= 1) return notebooks;
  return notebooks.map(notebook => notebook.id === id ? { ...notebook, archivedAt } : notebook);
}

export function restoreNotebook(
  notebooks: WorkspaceNotebook[],
  id: string,
  updatedAt = new Date().toISOString(),
): WorkspaceNotebook[] {
  return notebooks.map(notebook => notebook.id === id
    ? { ...notebook, archivedAt: undefined, updatedAt }
    : notebook);
}
