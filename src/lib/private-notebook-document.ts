import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeNotebookId } from '@/lib/notebook-scope';
import { isChatHistoryDocument } from '@/lib/chat-history-document';

export interface PrivateNotebookScope {
  ownerMemberId: string;
  notebookId: string;
}

export interface NotebookDocument<T> {
  revision: string;
  updatedAt: string;
  data: T;
}

export class NotebookDocumentConflict extends Error {
  constructor() { super('另一个页面已保存新内容，请先读取已保存内容。'); }
}

const writes = new Map<string, Promise<unknown>>();
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

export { directory as notebookDocumentDirectory };

function directory(scope: PrivateNotebookScope, name: string): string {
  if (!scope.ownerMemberId.trim() || normalizeNotebookId(scope.notebookId) !== scope.notebookId || !/^[a-z][a-z-]{0,63}$/.test(name)) {
    throw new Error('请先登录并打开文献本。');
  }
  return path.join(process.env.STUDIO_DOCUMENT_STORE_DIR?.trim() || path.join(process.cwd(), '.data', 'studio-documents'), digest(scope.ownerMemberId), scope.notebookId, name);
}

export async function readNotebookDocument<T>(scope: PrivateNotebookScope, name: string, revision?: string): Promise<NotebookDocument<T> | null> {
  const root = directory(scope, name);
  if (revision !== undefined && !/^[a-f0-9]{64}$/.test(revision)) throw new Error('保存版本无效。');
  let raw: string;
  try { raw = await readFile(path.join(root, revision ? `${revision}.json` : 'current.json'), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (revision && name === 'chat-history') {
        const current = await readNotebookDocument<T>(scope, name);
        return current?.revision === revision ? current : null;
      }
      return null;
    }
    throw error;
  }
  const saved = JSON.parse(raw) as NotebookDocument<T>;
  if (!saved.revision || !saved.updatedAt || saved.data === undefined || saved.revision !== digest(JSON.stringify(saved.data)) || (revision && saved.revision !== revision)) {
    throw new Error('保存记录校验失败，请稍后重试。');
  }
  return saved;
}

async function atomicWrite(file: string, data: string) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { mode: 0o600 });
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

// Production uses one PM2 worker. Serialize competing writes before comparing revisions.
export async function saveNotebookDocument<T>(scope: PrivateNotebookScope, name: string, data: T, expectedRevision: string | null): Promise<NotebookDocument<T>> {
  const root = directory(scope, name);
  const task = (writes.get(root) || Promise.resolve()).catch(() => undefined).then(async () => {
    const previous = await readNotebookDocument<T>(scope, name);
    const serialized = JSON.stringify(data);
    if (Buffer.byteLength(serialized) > 1_000_000) throw new Error('内容过大，暂时无法保存。');
    const revision = digest(serialized);
    if (previous?.revision === revision) return previous;
    if ((previous?.revision || null) !== expectedRevision) throw new NotebookDocumentConflict();
    const saved = { revision, updatedAt: new Date().toISOString(), data };
    await mkdir(root, { recursive: true, mode: 0o700 });
    // Chat drafts and in-flight responses replace recovery state, not permanent history.
    const keepVersion = name !== 'chat-history' || (isChatHistoryDocument(data)
      && data.messages.length > 0 && !data.messages.some(item => item.generation?.status === 'pending')
      && (!isChatHistoryDocument(previous?.data) || JSON.stringify(previous.data.messages) !== JSON.stringify(data.messages)));
    if (keepVersion && (name !== 'chat-history' || !await readNotebookDocument(scope, name, revision))) {
      await atomicWrite(path.join(root, `${revision}.json`), JSON.stringify(saved));
    }
    await atomicWrite(path.join(root, 'current.json'), JSON.stringify(saved));
    return saved;
  });
  writes.set(root, task);
  try { return await task; }
  finally { if (writes.get(root) === task) writes.delete(root); }
}
