import path from 'path';
import { access, mkdir } from 'fs/promises';
import { constants } from 'fs';

export function resolveLocalUploadsDir(cwd = process.cwd()): string {
  const configuredDir = process.env.LOCAL_FILE_STORAGE_DIR?.trim();
  return configuredDir ? path.resolve(configuredDir) : path.join(cwd, 'public', 'uploads');
}

export async function localUploadStoreStatus() {
  const storePath = resolveLocalUploadsDir();
  try {
    await mkdir(storePath, { recursive: true });
    await access(storePath, constants.W_OK);
    return { path: storePath, writable: true };
  } catch {
    return { path: storePath, writable: false };
  }
}
