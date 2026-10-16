import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { catalogContentKey } from '@/lib/catalog-content-key';
import type { WorkbenchPreferences, WorkspaceNotebook } from '@/components/home/workspace-types';

export type NotebookCatalog = {
  notebooks: WorkspaceNotebook[];
  activeNotebookId: string | null;
  workbenchPreferences?: WorkbenchPreferences;
  updatedAt: string;
  revision?: string;
};

type NotebookCatalogFile = {
  version: 1;
  catalogs: Record<string, NotebookCatalog>;
};

let writeQueue = Promise.resolve();

function catalogPath(): string {
  const configured = process.env.NOTEBOOK_CATALOG_STORE_PATH?.trim();
  if (configured) return path.resolve(configured);
  const sourceStorePath = process.env.SOURCE_STORE_PATH?.trim();
  if (sourceStorePath) return path.join(path.dirname(path.resolve(sourceStorePath)), 'notebooks.json');
  return path.resolve(process.cwd(), '.data/notebooks/notebooks.json');
}

async function readStore(): Promise<NotebookCatalogFile> {
  try {
    const parsed = JSON.parse(await readFile(catalogPath(), 'utf8')) as NotebookCatalogFile;
    if (parsed.version === 1 && parsed.catalogs && typeof parsed.catalogs === 'object' && !Array.isArray(parsed.catalogs)) return parsed;
    throw new Error('文献本列表格式异常，请稍后重试。');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return { version: 1, catalogs: {} };
}

export class NotebookCatalogConflict extends Error {}
function withRevision(catalog: NotebookCatalog): NotebookCatalog {
  const { revision: _revision, ...data } = catalog;
  return { ...data, revision: createHash('sha256').update(JSON.stringify(data)).digest('hex') };
}

function cleanNotebook(value: WorkspaceNotebook): WorkspaceNotebook | null {
  const id = String(value.id || '').trim().slice(0, 128);
  if (!id) return null;
  const title = String(value.title || '').trim().slice(0, 160) || '未命名文献本';
  const updatedAt = Number.isNaN(Date.parse(value.updatedAt)) ? new Date().toISOString() : value.updatedAt;
  const notebook: WorkspaceNotebook = {
    id,
    title,
    sourceCount: Math.max(0, Math.floor(Number(value.sourceCount) || 0)),
    updatedAt,
    accent: String(value.accent || '').slice(0, 160),
  };
  if (value.archivedAt && !Number.isNaN(Date.parse(value.archivedAt))) notebook.archivedAt = value.archivedAt;
  if (value.templateId) notebook.templateId = String(value.templateId).slice(0, 128);
  return notebook;
}

function cleanCatalog(input: {
  notebooks: WorkspaceNotebook[];
  activeNotebookId?: string | null;
}): Omit<NotebookCatalog, 'updatedAt'> {
  const notebooks = input.notebooks.slice(0, 200).map(cleanNotebook).filter(Boolean) as WorkspaceNotebook[];
  const requestedActiveId = String(input.activeNotebookId || '').trim();
  const activeNotebookId = notebooks.some(notebook => notebook.id === requestedActiveId)
    ? requestedActiveId
    : notebooks.find(notebook => !notebook.archivedAt)?.id || null;
  return { notebooks, activeNotebookId };
}

function cleanWorkbenchPreferences(value?: WorkbenchPreferences): WorkbenchPreferences {
  if (!value) return {};
  const preferences: WorkbenchPreferences = {};
  if (Number.isFinite(value.leftPanelWidth)) {
    preferences.leftPanelWidth = Math.max(220, Math.min(450, Math.round(Number(value.leftPanelWidth))));
  }
  if (Number.isFinite(value.rightPanelWidth)) {
    preferences.rightPanelWidth = Math.max(360, Math.min(680, Math.round(Number(value.rightPanelWidth))));
  }
  if (typeof value.leftPanelCollapsed === 'boolean') preferences.leftPanelCollapsed = value.leftPanelCollapsed;
  if (typeof value.rightPanelCollapsed === 'boolean') preferences.rightPanelCollapsed = value.rightPanelCollapsed;
  if (value.activeStudioTool === null) preferences.activeStudioTool = null;
  else if (typeof value.activeStudioTool === 'string') {
    preferences.activeStudioTool = value.activeStudioTool.trim().slice(0, 64) || null;
  }
  return preferences;
}

export async function getNotebookCatalog(ownerMemberId: string): Promise<NotebookCatalog | null> {
  const store = await readStore();
  return store.catalogs[ownerMemberId] ? withRevision(store.catalogs[ownerMemberId]) : null;
}

export async function saveNotebookCatalog(
  ownerMemberId: string,
  input: {
    notebooks: WorkspaceNotebook[];
    activeNotebookId?: string | null;
    workbenchPreferences?: WorkbenchPreferences;
    expectedRevision?: string | null;
  },
): Promise<NotebookCatalog> {
  let saved!: NotebookCatalog;
  const nextWrite = writeQueue.then(async () => {
    const store = await readStore();
    const currentRevision = store.catalogs[ownerMemberId] ? withRevision(store.catalogs[ownerMemberId]).revision : null;
    const previousPreferences = store.catalogs[ownerMemberId]?.workbenchPreferences;
    saved = {
      ...cleanCatalog(input),
      workbenchPreferences: input.workbenchPreferences === undefined
        ? previousPreferences
        : cleanWorkbenchPreferences(input.workbenchPreferences),
      updatedAt: new Date().toISOString(),
    };
    const previous = store.catalogs[ownerMemberId];
    if (previous && catalogContentKey({ ...previous, updatedAt: undefined }) === catalogContentKey({ ...saved, updatedAt: undefined })) { saved = previous; return; }
    if (input.expectedRevision !== currentRevision) throw new NotebookCatalogConflict('另一页面已修改文献本列表，请先读取已保存列表。');
    store.catalogs[ownerMemberId] = saved;
    const target = catalogPath();
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, target);
  });
  writeQueue = nextWrite.then(() => undefined, () => undefined);
  await nextWrite;
  return withRevision(saved);
}
