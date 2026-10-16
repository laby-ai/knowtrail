import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { notebookDocumentDirectory, readNotebookDocument, type PrivateNotebookScope } from '@/lib/private-notebook-document';
import type { PptDeckDocument, PptDeckKind } from '@/lib/ppt/deck-document';
import { PptDeckAccessError } from '@/lib/ppt/deck-store';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const idPattern = /^[a-f0-9]{64}$/;
const contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

async function version(scope: PrivateNotebookScope, kind: PptDeckKind, revision: string) {
  if (!idPattern.test(revision)) throw new PptDeckAccessError('简报版本不完整，请重新读取。', 400);
  const saved = await readNotebookDocument<PptDeckDocument>(scope, kind, revision);
  if (!saved?.data.deck) throw new PptDeckAccessError('简报不存在或无权访问。', 404);
  return saved.data.deck;
}

export async function saveDeckExport(scope: PrivateNotebookScope, kind: PptDeckKind, revision: string, buffer: Buffer) {
  const deck = await version(scope, kind, revision);
  if (buffer.length > 80_000_000 || buffer.length < 4 || !buffer.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))) throw new PptDeckAccessError('导出文件格式或大小异常，请重试。', 422);
  const id = sha(buffer);
  const root = path.join(notebookDocumentDirectory(scope, kind), 'exports', revision);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, id + '.pptx');
  const temporary = file + '.' + randomUUID() + '.tmp';
  try { await writeFile(temporary, buffer, { mode: 0o600 }); await rename(temporary, file); }
  catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
  const params = new URLSearchParams({ kind, notebookId: scope.notebookId, revision, exportId: id });
  return { id, fileName: deck.deckTitle.replace(/[\\/:*?"<>|]/g, '_') + '.pptx', url: `${(process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '')}/api/studio/artifacts?${params}` };
}

export async function readDeckExport(scope: PrivateNotebookScope, kind: PptDeckKind, revision: string, id: string) {
  const deck = await version(scope, kind, revision);
  if (!idPattern.test(id)) throw new PptDeckAccessError('导出文件不存在。', 404);
  let buffer: Buffer;
  try { buffer = await readFile(path.join(notebookDocumentDirectory(scope, kind), 'exports', revision, id + '.pptx')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new PptDeckAccessError('导出文件不存在。', 404); throw error; }
  if (sha(buffer) !== id) throw new Error('导出文件校验失败。');
  return { buffer, contentType, fileName: deck.deckTitle.replace(/[\\/:*?"<>|]/g, '_') + '.pptx' };
}
