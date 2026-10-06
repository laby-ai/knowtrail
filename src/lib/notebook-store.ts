import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { WorkspaceNotebook } from '@/components/home/workspace-types';
import { listIngestionSources } from '@/lib/ingestion-store';
const accent = 'from-sky-50 via-white to-cyan-50';
let queue: Promise<unknown> = Promise.resolve();
function location(owner?: string) {
  const root = process.env.NOTEBOOK_STORE_PATH || path.join(path.dirname(process.env.SOURCE_STORE_PATH || path.join(process.cwd(), '.data/sources/sources.json')), 'notebooks');
  return path.join(root, createHash('sha256').update(owner ? `member:${owner}` : 'guest').digest('hex') + '.json');
}
async function read(owner?: string): Promise<WorkspaceNotebook[]> {
  try { const data: unknown = JSON.parse(await readFile(location(owner), 'utf8')); if (!Array.isArray(data)) throw new Error('invalid_notebook_store'); return data; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
export async function saveNotebookMetadata(owner: string | undefined, entries: Pick<WorkspaceNotebook, 'id' | 'title'>[], onlyMissing = false) {
  const write = queue.then(async () => {
    const notebooks = await read(owner);
    for (const entry of entries) {
      const index = notebooks.findIndex(item => item.id === entry.id);
      if (index >= 0 && onlyMissing) continue;
      const next = { id: entry.id, title: entry.title, sourceCount: 0, updatedAt: new Date().toISOString(), accent };
      if (index >= 0) notebooks[index] = { ...notebooks[index], ...next }; else notebooks.push(next);
    }
    const target = location(owner); await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(notebooks), { mode: 0o600 }); await rename(temporary, target);
  });
  queue = write.catch(() => undefined); await write;
}
export async function listNotebooks(owner?: string): Promise<WorkspaceNotebook[]> {
  const notebooks = await read(owner);
  const sources = (await listIngestionSources({ ownerMemberId: owner })).filter(source => (source.ownerMemberId || undefined) === owner);
  for (const source of sources) {
    const id = source.notebookId || 'default-workspace';
    if (!notebooks.some(item => item.id === id)) notebooks.push({ id, title: '已有文献本', updatedAt: source.createdAt, accent, sourceCount: 0 });
  }
  return notebooks.map(item => {
    const matches = sources.filter(source => (source.notebookId || 'default-workspace') === item.id);
    return { ...item, sourceCount: matches.length, updatedAt: matches.reduce((latest, source) => source.updatedAt > latest ? source.updatedAt : latest, item.updatedAt) };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}