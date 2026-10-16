import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeNotebookId } from '@/lib/notebook-scope';

export interface StructuredPptScope {
  ownerMemberId: string;
  notebookId: string;
}

export interface StructuredPptArtifact extends StructuredPptScope {
  id: string;
  fileName: string;
  bytes: number;
  slideCount: number;
  sourceIds: string[];
  createdAt: string;
}

function scopeDirectory(scope: StructuredPptScope): string {
  if (!scope.ownerMemberId.trim() || normalizeNotebookId(scope.notebookId) !== scope.notebookId) {
    throw new Error('请先登录并打开文献本。');
  }
  const owner = createHash('sha256').update(scope.ownerMemberId).digest('hex');
  return path.join(
    process.env.STRUCTURED_PPT_STORE_DIR?.trim() || path.join(process.cwd(), '.data', 'structured-ppts'),
    owner,
    scope.notebookId,
  );
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWrite(file: string, data: string | Buffer): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { mode: 0o600 });
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export class StructuredPptConflict extends Error {}
const writes = new Map<string, Promise<void>>();
type SaveInput = StructuredPptScope & {
  buffer: Buffer;
  fileName: string;
  slideCount: number;
  sourceIds: string[];
  expectedArtifactId?: string | null;
};
export async function saveStructuredPpt(input: SaveInput): Promise<StructuredPptArtifact> {
  const key = scopeDirectory(input);
  let saved!: StructuredPptArtifact;
  const running = (writes.get(key) || Promise.resolve()).then(async () => { saved = await writeStructuredPpt(input); });
  const settled = running.then(() => undefined, () => undefined);
  writes.set(key, settled);
  try { await running; return saved; } finally { if (writes.get(key) === settled) writes.delete(key); }
}
async function writeStructuredPpt(input: SaveInput): Promise<StructuredPptArtifact> {
  const directory = scopeDirectory(input);
  const id = createHash('sha256').update(input.buffer).digest('hex');
  const latest = await readStructuredPpt(input);
  if (latest?.artifact.id === id) return latest.artifact;
  if (input.expectedArtifactId !== undefined && input.expectedArtifactId !== (latest?.artifact.id || null)) throw new StructuredPptConflict('另一页面已保存新PPT，请先重新读取。');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const existing = await readJson(path.join(directory, `${id}.json`)) as StructuredPptArtifact | null;
  const artifact: StructuredPptArtifact = existing || {
    id,
    ownerMemberId: input.ownerMemberId,
    notebookId: input.notebookId,
    fileName: input.fileName,
    slideCount: input.slideCount,
    sourceIds: input.sourceIds,
    bytes: input.buffer.length,
    createdAt: new Date().toISOString(),
  };
  if (artifact.id !== id || artifact.bytes !== input.buffer.length || artifact.ownerMemberId !== input.ownerMemberId || artifact.notebookId !== input.notebookId) {
    throw new Error('演示文稿保存记录异常，请稍后重试。');
  }
  await atomicWrite(path.join(directory, `${id}.pptx`), input.buffer);
  await atomicWrite(path.join(directory, `${id}.json`), JSON.stringify(artifact));
  // Publish latest only after the immutable file and its metadata are complete.
  await atomicWrite(path.join(directory, 'latest.json'), JSON.stringify({ id }));
  return artifact;
}

export async function readStructuredPpt(
  scope: StructuredPptScope,
  artifactId?: string,
): Promise<{ artifact: StructuredPptArtifact; buffer: Buffer } | null> {
  const directory = scopeDirectory(scope);
  const latest = artifactId ? null : await readJson(path.join(directory, 'latest.json')) as { id?: string } | null;
  const id = artifactId || latest?.id;
  if (!latest && !artifactId) return null;
  if (!id || !/^[a-f0-9]{64}$/.test(id)) throw new Error('演示文稿版本记录异常，请稍后重试。');
  const artifact = await readJson(path.join(directory, `${id}.json`)) as StructuredPptArtifact | null;
  if (!artifact || artifact.id !== id || artifact.ownerMemberId !== scope.ownerMemberId || artifact.notebookId !== scope.notebookId) return null;
  const buffer = await readFile(path.join(directory, `${id}.pptx`));
  if (buffer.length !== artifact.bytes || createHash('sha256').update(buffer).digest('hex') !== id) {
    throw new Error('演示文稿文件校验失败，请稍后重试。');
  }
  return { artifact, buffer };
}
