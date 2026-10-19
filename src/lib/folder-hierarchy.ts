import type { ProjectFolder } from '@/types';

export type FolderRow = { folder: ProjectFolder; depth: number; ancestors: string[]; path: string };

/** Stable forest traversal; legacy missing parents and corrupt cycles stay visible. */
export function folderRows(folders: ProjectFolder[]): FolderRow[] {
  const ids = new Set(folders.map(folder => folder.id));
  const children = new Map<string | null, ProjectFolder[]>();
  for (const folder of folders) {
    const parent = folder.parentId && ids.has(folder.parentId) && folder.parentId !== folder.id ? folder.parentId : null;
    children.set(parent, [...(children.get(parent) || []), folder]);
  }
  const rows: FolderRow[] = [];
  const visited = new Set<string>();
  const walk = (roots: ProjectFolder[]) => {
    const stack = roots.toReversed().map(folder => ({ folder, ancestors: [] as string[], names: [] as string[] }));
    while (stack.length) {
      const item = stack.pop()!;
      if (visited.has(item.folder.id)) continue;
      visited.add(item.folder.id);
      const names = [...item.names, item.folder.name];
      rows.push({ folder: item.folder, depth: item.ancestors.length, ancestors: item.ancestors, path: names.join(' / ') });
      for (const child of (children.get(item.folder.id) || []).toReversed()) stack.push({ folder: child, ancestors: [...item.ancestors, item.folder.id], names });
    }
  };
  walk(children.get(null) || []);
  walk(folders.filter(folder => !visited.has(folder.id)));
  return rows;
}

export function canMoveFolder(folders: ProjectFolder[], id: string, parentId: string | null): boolean {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  if (!byId.has(id)) return false;
  const seen = new Set([id]);
  let current = parentId;
  while (current) {
    if (seen.has(current) || !byId.has(current)) return false;
    seen.add(current);
    current = byId.get(current)?.parentId || null;
  }
  return true;
}

export function reparentFolder(folders: ProjectFolder[], id: string, parentId: string | null): ProjectFolder[] {
  if (!canMoveFolder(folders, id, parentId)) return folders;
  return folders.map(folder => folder.id === id ? { ...folder, parentId, updatedAt: new Date().toISOString() } : folder);
}

export function deleteFolderKeepingChildren(folders: ProjectFolder[], id: string): ProjectFolder[] {
  const parentId = folders.find(folder => folder.id === id)?.parentId || null;
  return folders.filter(folder => folder.id !== id).map(folder => folder.parentId === id ? { ...folder, parentId } : folder);
}
