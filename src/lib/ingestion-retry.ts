import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractDocumentContent } from '@/lib/document-extraction';
import { ingestExtractedSource } from '@/lib/ingestion-store';
import { retrieveFileBuffer } from '@/lib/storage';
import type { IngestExtractedSourceOptions, StoredSourceRecord } from '@/lib/source-store/types';

export class IngestionRetryError extends Error {
  constructor(message: string, public readonly code: 'not_retryable' | 'source_unavailable' | 'empty_content') {
    super(message);
    this.name = 'IngestionRetryError';
  }
}

export type RetryDependencies = {
  retrieve: typeof retrieveFileBuffer;
  extract: typeof extractDocumentContent;
  ingest: typeof ingestExtractedSource;
};

const defaultDependencies: RetryDependencies = {
  retrieve: retrieveFileBuffer,
  extract: extractDocumentContent,
  ingest: ingestExtractedSource,
};

export async function retryIngestionSource(
  source: StoredSourceRecord,
  options: IngestExtractedSourceOptions = {},
  dependencies: RetryDependencies = defaultDependencies,
): Promise<StoredSourceRecord> {
  if (source.status !== 'failed' && source.status !== 'error') {
    throw new IngestionRetryError('当前文献无需重新处理。', 'not_retryable');
  }
  const storageKey = source.storageKey || source.fileUrl;
  if (!storageKey) {
    throw new IngestionRetryError('原始文件不可用，请重新上传。', 'source_unavailable');
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-retry-'));
  const extension = source.fileType || source.fileName.split('.').pop()?.toLowerCase() || 'bin';
  const tempPath = path.join(tempDir, `source.${extension}`);
  try {
    await writeFile(tempPath, await dependencies.retrieve(storageKey));
    const extracted = await dependencies.extract(tempPath, extension);
    if (!extracted.trim()) {
      throw new IngestionRetryError('未能从原始文件提取正文，请检查文件是否损坏或重新上传。', 'empty_content');
    }
    return dependencies.ingest({
      id: source.id,
      createdAt: source.createdAt,
      ownerMemberId: source.ownerMemberId,
      notebookId: source.notebookId,
      fileName: source.fileName,
      fileType: source.fileType,
      fileSize: source.fileSize,
      fileKey: source.storageKey,
      fileUrl: source.fileUrl,
      title: source.title,
      shortName: source.shortName,
      content: extracted.slice(0, 15_000),
      rawContent: extracted.slice(0, 50_000),
    }, options);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
