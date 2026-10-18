import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import path from 'path';
import {
  DEFAULT_SOURCE_STORE_PATH,
  type SourceStoreAdapter,
  type SourceStoreAdapterStatus,
  type SourceStoreFile,
} from '@/lib/source-store/types';

function nowIso(): string {
  return new Date().toISOString();
}

export class LocalJsonSourceStoreAdapter implements SourceStoreAdapter {
  private writeQueue = Promise.resolve();

  private sourceStorePath(): string {
    const configured = process.env.SOURCE_STORE_PATH?.trim();
    return path.resolve(process.cwd(), configured || DEFAULT_SOURCE_STORE_PATH);
  }

  async read(): Promise<SourceStoreFile> {
    const targetPath = this.sourceStorePath();
    try {
      const raw = await readFile(targetPath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || parsed.version !== 1 || !('sources' in parsed) || !Array.isArray(parsed.sources)) {
        throw new Error('资料索引格式损坏，已停止写入以保留原文件。');
      }
      return parsed as SourceStoreFile;
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('资料索引格式损坏，已停止写入以保留原文件。');
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }

    return { version: 1, updatedAt: nowIso(), sources: [] };
  }

  private async write(store: SourceStoreFile): Promise<void> {
    const targetPath = this.sourceStorePath();
    await mkdir(path.dirname(targetPath), { recursive: true });
    const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
    await rename(tmpPath, targetPath);
  }

  async mutate(mutator: (store: SourceStoreFile) => SourceStoreFile | Promise<SourceStoreFile>): Promise<SourceStoreFile> {
    const nextWrite = this.writeQueue.then(async () => {
      const current = await this.read();
      const updated = await mutator(current);
      updated.updatedAt = nowIso();
      await this.write(updated);
      return updated;
    });
    this.writeQueue = nextWrite.then(() => undefined, () => undefined);
    return nextWrite;
  }

  status(): SourceStoreAdapterStatus {
    return {
      provider: 'local-json',
      configured: true,
      path: this.sourceStorePath(),
    };
  }
}
