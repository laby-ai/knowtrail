import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { notebookDocumentDirectory, readNotebookDocument, type PrivateNotebookScope } from '@/lib/private-notebook-document';
import type { PptDeckDocument, PptDeckKind } from '@/lib/ppt/deck-document';
import { PptDeckAccessError } from '@/lib/ppt/deck-store';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const idPattern = /^[a-f0-9]{64}$/;
const contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

function exportDirectories(scope: PrivateNotebookScope, kind: PptDeckKind, revision: string, deck: NonNullable<PptDeckDocument['deck']>) {
  // Reading position and image undo history do not change the rendered file.
  const content = sha(Buffer.from(JSON.stringify({ title: deck.deckTitle, slides: deck.slides, aspectRatio: 'aspectRatio' in deck ? deck.aspectRatio : '16:9' })));
  const root = path.join(notebookDocumentDirectory(scope, kind), 'exports');
  return [path.join(root, content), path.join(root, revision)];
}
function metadata(scope: PrivateNotebookScope, kind: PptDeckKind, revision: string, id: string, title: string) {
  const params = new URLSearchParams({ kind, notebookId: scope.notebookId, revision, exportId: id });
  return { id, fileName: title.replace(/[\\/:*?"<>|]/g, '_') + '.pptx', url: `${(process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '')}/api/studio/artifacts?${params}` };
}

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
  const [root] = exportDirectories(scope, kind, revision, deck);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, id + '.pptx');
  const temporary = file + '.' + randomUUID() + '.tmp';
  try { await writeFile(temporary, buffer, { mode: 0o600 }); await rename(temporary, file); }
  catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
  return metadata(scope, kind, revision, id, deck.deckTitle);
}

export async function readDeckExport(scope: PrivateNotebookScope, kind: PptDeckKind, revision: string, id: string) {
  const deck = await version(scope, kind, revision);
  if (!idPattern.test(id)) throw new PptDeckAccessError('导出文件不存在。', 404);
  let buffer: Buffer | undefined;
  for (const root of exportDirectories(scope, kind, revision, deck)) {
    try { buffer = await readFile(path.join(root, id + '.pptx')); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  if (!buffer) throw new PptDeckAccessError('导出文件不存在。', 404);
  if (sha(buffer) !== id) throw new Error('导出文件校验失败。');
  return { buffer, contentType, fileName: deck.deckTitle.replace(/[\\/:*?"<>|]/g, '_') + '.pptx' };
}

export async function latestDeckExport(scope: PrivateNotebookScope, kind: PptDeckKind, revision: string) {
  const deck = await version(scope, kind, revision);
  const files: Array<{ id: string; time: number }> = [];
  for (const root of exportDirectories(scope, kind, revision, deck)) {
    let names: string[];
    try { names = await readdir(root); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    for (const name of names) if (/^[a-f0-9]{64}\.pptx$/.test(name)) files.push({ id: name.slice(0, -5), time: (await stat(path.join(root, name))).mtimeMs });
  }
  const latest = files.sort((a, b) => b.time - a.time)[0];
  if (!latest) return null;
  await readDeckExport(scope, kind, revision, latest.id);
  return metadata(scope, kind, revision, latest.id, deck.deckTitle);
}
