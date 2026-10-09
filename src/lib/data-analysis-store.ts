import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import type { StoredDataAnalysis } from './data-analysis-contract';
function directory(owner: string) {
  const root = process.env.DATA_ANALYSIS_STORE_DIR || path.join(path.dirname(process.env.SOURCE_STORE_PATH || path.join(process.cwd(), '.data/sources/sources.json')), 'data-analyses');
  return path.join(root, createHash('sha256').update(owner).digest('hex'));
}
export async function saveDataAnalysis(value: Omit<StoredDataAnalysis, 'id' | 'createdAt'>): Promise<StoredDataAnalysis> {
  const result: StoredDataAnalysis = { ...value, id: randomUUID(), createdAt: new Date().toISOString() };
  const root = directory(value.ownerMemberId); await mkdir(root, { recursive: true });
  const target = path.join(root, result.id + '.json'); const temporary = target + '.tmp';
  await writeFile(temporary, JSON.stringify(result), { mode: 0o600 }); await rename(temporary, target);
  return result;
}
export async function readDataAnalysis(owner: string, id: string): Promise<StoredDataAnalysis> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('invalid_analysis_id');
  const result = JSON.parse(await readFile(path.join(directory(owner), id + '.json'), 'utf8')) as StoredDataAnalysis;
  if (result.ownerMemberId !== owner || result.id !== id) throw new Error('invalid_analysis_owner');
  return result;
}
