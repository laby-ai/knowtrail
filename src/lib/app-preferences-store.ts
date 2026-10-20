import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { appPreferencesSchema, DEFAULT_APP_PREFERENCES, type AppPreferences } from './app-preferences';

function location(owner: string) {
  const root = process.env.APP_PREFERENCES_STORE_DIR || path.join(path.dirname(process.env.SOURCE_STORE_PATH || path.join(process.cwd(), '.data/sources/sources.json')), 'app-preferences');
  return path.join(root, createHash('sha256').update(owner).digest('hex') + '.json');
}
export async function readAppPreferences(owner: string): Promise<AppPreferences> {
  try { return appPreferencesSchema.parse(JSON.parse(await readFile(location(owner), 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_APP_PREFERENCES };
    throw error;
  }
}
export async function saveAppPreferences(owner: string, value: unknown): Promise<AppPreferences> {
  const preferences = appPreferencesSchema.parse(value);
  const target = location(owner);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = target + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(preferences), { mode: 0o600 });
  await rename(temporary, target);
  return preferences;
}
