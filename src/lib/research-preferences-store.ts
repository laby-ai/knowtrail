import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_RESEARCH_PREFERENCES, parseResearchPreferences, type ResearchPreferences } from './research-preferences';

let queue: Promise<unknown> = Promise.resolve();
function location(owner: string) {
  const root = process.env.RESEARCH_PREFERENCES_STORE_DIR || path.join(path.dirname(process.env.SOURCE_STORE_PATH || path.join(process.cwd(), '.data/sources/sources.json')), 'research-preferences');
  return path.join(root, createHash('sha256').update(owner).digest('hex') + '.json');
}
export async function readResearchPreferences(owner: string) {
  try { return { configured: true, preferences: parseResearchPreferences(JSON.parse(await readFile(location(owner), 'utf8'))) }; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { configured: false, preferences: DEFAULT_RESEARCH_PREFERENCES };
    throw error;
  }
}
export async function saveResearchPreferences(owner: string, preferences: ResearchPreferences) {
  const validated = parseResearchPreferences(preferences);
  const operation = queue.then(async () => {
    const target = location(owner); await mkdir(path.dirname(target), { recursive: true });
    const temporary = target + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(validated), { mode: 0o600 }); await rename(temporary, target);
  });
  queue = operation.catch(() => undefined); await operation;
  return { configured: true, preferences: validated };
}
