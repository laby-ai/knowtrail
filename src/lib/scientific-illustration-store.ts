import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  inspectGeneratedImage,
  type ScientificIllustrationAspectRatio,
  type ScientificIllustrationKind,
} from '@/lib/scientific-illustration-contract';

export interface ScientificIllustrationMetadata {
  id: string;
  ownerMemberId?: string;
  notebookId?: string;
  purpose: string;
  figureKind: ScientificIllustrationKind;
  aspectRatio: ScientificIllustrationAspectRatio;
  sourceLabels: string[];
  createdAt: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  extension: 'png' | 'jpg' | 'webp';
  width: number | null;
  height: number | null;
  bytes: number;
}

function storeDir(): string {
  return process.env.SCIENTIFIC_ILLUSTRATION_STORE_DIR?.trim()
    || path.join(process.cwd(), '.data', 'scientific-illustrations');
}

function validId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function metadataPath(id: string): string {
  return path.join(storeDir(), `${id}.json`);
}

export async function saveScientificIllustration(input: {
  image: Buffer;
  ownerMemberId?: string;
  notebookId?: string;
  purpose: string;
  figureKind: ScientificIllustrationKind;
  aspectRatio: ScientificIllustrationAspectRatio;
  sourceLabels: string[];
}): Promise<ScientificIllustrationMetadata> {
  const info = inspectGeneratedImage(input.image);
  const id = randomUUID();
  const metadata: ScientificIllustrationMetadata = {
    id,
    ownerMemberId: input.ownerMemberId,
    notebookId: input.notebookId,
    purpose: input.purpose,
    figureKind: input.figureKind,
    aspectRatio: input.aspectRatio,
    sourceLabels: input.sourceLabels,
    createdAt: new Date().toISOString(),
    ...info,
  };
  const dir = storeDir();
  await mkdir(dir, { recursive: true });
  const imagePath = path.join(dir, `${id}.${info.extension}`);
  const tempImagePath = `${imagePath}.tmp`;
  const tempMetadataPath = `${metadataPath(id)}.tmp`;
  await writeFile(tempImagePath, input.image);
  await writeFile(tempMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  await rename(tempImagePath, imagePath);
  await rename(tempMetadataPath, metadataPath(id));
  return metadata;
}

export async function readScientificIllustration(
  id: string,
  ownerMemberId?: string,
): Promise<{ metadata: ScientificIllustrationMetadata; imagePath: string; image: Buffer }> {
  if (!validId(id)) throw new Error('科研示意图不存在。');
  let metadata: ScientificIllustrationMetadata;
  try {
    metadata = JSON.parse(await readFile(metadataPath(id), 'utf8')) as ScientificIllustrationMetadata;
  } catch {
    throw new Error('科研示意图不存在。');
  }
  if (metadata.id !== id || !['png', 'jpg', 'webp'].includes(metadata.extension)) {
    throw new Error('科研示意图元数据无效。');
  }
  if (metadata.ownerMemberId && metadata.ownerMemberId !== ownerMemberId) {
    throw new Error('无权访问该科研示意图。');
  }
  const imagePath = path.join(storeDir(), `${id}.${metadata.extension}`);
  const image = await readFile(imagePath).catch(() => {
    throw new Error('科研示意图文件不存在。');
  });
  inspectGeneratedImage(image);
  return { metadata, imagePath, image };
}
