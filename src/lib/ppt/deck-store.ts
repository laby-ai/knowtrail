import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { notebookDocumentDirectory, saveNotebookDocument, type PrivateNotebookScope } from '@/lib/private-notebook-document';
import { isHtmlDeckDocument, isImageDeckDocument, type PptDeckDocument, type PptDeckKind } from '@/lib/ppt/deck-document';

export class PptDeckAccessError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
function mime(buffer: Buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  throw new PptDeckAccessError('图片文件格式无效，未保存简报。', 422);
}
function assetDirectory(scope: PrivateNotebookScope) { return path.join(notebookDocumentDirectory(scope, 'image-deck'), 'assets'); }
function assetUrl(scope: PrivateNotebookScope, id: string) {
  const base = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
  return `${base}/api/studio/artifacts?${new URLSearchParams({ kind: 'image-deck', notebookId: scope.notebookId, assetId: id })}`;
}
export async function readDeckImage(scope: PrivateNotebookScope, id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new PptDeckAccessError('图片不存在。', 404);
  let buffer: Buffer;
  try { buffer = await readFile(path.join(assetDirectory(scope), id)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new PptDeckAccessError('图片不存在。', 404); throw error; }
  if (digest(buffer) !== id) throw new Error('图片文件校验失败。');
  return { buffer, contentType: mime(buffer) };
}
async function privateImage(scope: PrivateNotebookScope, url: string) {
  if (url.startsWith('data:')) {
    const match = url.match(/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match || match[1].length > 45_000_000) throw new PptDeckAccessError('图片格式或大小无效。', 422);
    const buffer = Buffer.from(match[1], 'base64'); mime(buffer);
    const id = digest(buffer); const root = assetDirectory(scope); await mkdir(root, { recursive: true, mode: 0o700 });
    const file = path.join(root, id); const temporary = file + '.' + randomUUID() + '.tmp';
    try { await writeFile(temporary, buffer, { mode: 0o600 }); await rename(temporary, file); }
    catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
    return assetUrl(scope, id);
  }
  const parsed = new URL(url, 'https://private.invalid');
  if (!url.startsWith('/') || !parsed.pathname.endsWith('/api/studio/artifacts') || parsed.searchParams.get('kind') !== 'image-deck' || parsed.searchParams.get('notebookId') !== scope.notebookId) throw new PptDeckAccessError('当前文献本无权保存这张图片。', 404);
  const id = parsed.searchParams.get('assetId') || ''; await readDeckImage(scope, id);
  return assetUrl(scope, id);
}
export async function savePptDeckDocument(scope: PrivateNotebookScope, kind: PptDeckKind, data: PptDeckDocument, expectedRevision: string | null) {
  if (kind === 'image-deck') {
    if (!isImageDeckDocument(data)) throw new PptDeckAccessError('图片简报内容不完整。', 422);
    if (data.deck) {
      const slides = await Promise.all(data.deck.slides.map(async slide => ({ ...slide, imageUrl: await privateImage(scope, slide.imageUrl!) })));
      const history = Object.fromEntries(await Promise.all(Object.entries(data.deck.history).map(async ([id, urls]) => [id, await Promise.all(urls.map(url => privateImage(scope, url)))])));
      data = { ...data, deck: { ...data.deck, slides, history } };
    }
  } else if (!isHtmlDeckDocument(data)) throw new PptDeckAccessError('HTML简报内容不完整。', 422);
  return saveNotebookDocument(scope, kind, data, expectedRevision);
}
