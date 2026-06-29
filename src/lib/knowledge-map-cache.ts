import { mkdir, readFile, writeFile } from 'fs/promises';
import crypto from 'node:crypto';
import path from 'path';
import type { RagSourceInput } from '@/lib/rag';
import type { RuntimeAIConfig } from '@/types';
import type { KnowledgeMapResponse } from '@/lib/knowledge-map-types';

export interface KnowledgeMapCacheHit extends KnowledgeMapResponse {
  cache: {
    hit: true;
    key: string;
    storedAt: string;
  };
}

const CACHE_VERSION = 2;
const CACHE_DIR = path.join(process.cwd(), '.data', 'knowledge-map');

function stablePaperSignature(paper: RagSourceInput) {
  const content = paper.rawContent || paper.content || '';
  return {
    id: paper.id,
    fileName: paper.fileName,
    fileType: paper.fileType,
    title: paper.title,
    shortName: paper.shortName,
    contentHash: crypto.createHash('sha256').update(content).digest('hex'),
  };
}

export function knowledgeMapCacheKey(
  papers: RagSourceInput[],
  aiConfig?: Partial<RuntimeAIConfig>,
  scope: { ownerMemberId?: string; notebookId?: string } = {},
): string {
  const signature = {
    version: CACHE_VERSION,
    ownerMemberId: scope.ownerMemberId || '',
    notebookId: scope.notebookId || '',
    papers: papers.map(stablePaperSignature),
    model: aiConfig?.model || '',
    apiBase: aiConfig?.apiBase || '',
  };
  return crypto.createHash('sha256').update(JSON.stringify(signature)).digest('hex').slice(0, 32);
}

function cachePath(key: string): string {
  return path.join(CACHE_DIR, `${key}.json`);
}

export async function readKnowledgeMapCache(
  papers: RagSourceInput[],
  aiConfig?: Partial<RuntimeAIConfig>,
  scope?: { ownerMemberId?: string; notebookId?: string },
): Promise<KnowledgeMapCacheHit | undefined> {
  const key = knowledgeMapCacheKey(papers, aiConfig, scope);
  try {
    const raw = await readFile(cachePath(key), 'utf-8');
    const parsed = JSON.parse(raw) as { version?: number; storedAt?: string; response?: KnowledgeMapResponse };
    if (
      parsed.version !== CACHE_VERSION ||
      !parsed.storedAt ||
      !parsed.response?.map?.nodes?.length ||
      !parsed.response?.map?.edges?.length
    ) {
      return undefined;
    }
    return {
      ...parsed.response,
      cache: {
        hit: true,
        key,
        storedAt: parsed.storedAt,
      },
    };
  } catch {
    return undefined;
  }
}

export async function writeKnowledgeMapCache(
  papers: RagSourceInput[],
  aiConfig: Partial<RuntimeAIConfig> | undefined,
  response: KnowledgeMapResponse,
  scope?: { ownerMemberId?: string; notebookId?: string },
): Promise<{ key: string; storedAt: string }> {
  const key = knowledgeMapCacheKey(papers, aiConfig, scope);
  const storedAt = new Date().toISOString();
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(
    cachePath(key),
    `${JSON.stringify({ version: CACHE_VERSION, storedAt, response }, null, 2)}\n`,
    'utf-8',
  );
  return { key, storedAt };
}
