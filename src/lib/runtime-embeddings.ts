import type { RuntimeAIConfig } from '@/types';
import {
  hasRuntimeAIProvider,
  redactRuntimeAISecrets,
  resolveOpenAIEmbeddingsEndpoint,
  resolveServerRuntimeAIConfig,
} from '@/lib/runtime-ai-config';
import { buildOpenAIHeaders, fetchWithTransientRetry } from '@/lib/runtime-ai-http';

interface OpenAIEmbeddingsResponse {
  data?: Array<{ index?: number; embedding?: number[] }> | { embedding?: number[] };
}

function resolveRuntimeEmbeddingModel(runtimeConfig?: Partial<RuntimeAIConfig>): string {
  if (runtimeConfig?.embeddingModel?.trim()) return runtimeConfig.embeddingModel.trim();
  return process.env.OPENAI_COMPAT_EMBEDDING_MODEL || 'text-embedding-3-small';
}

function isMultimodalEmbeddingModel(model: string): boolean {
  return /embedding-vision/i.test(model);
}

function extractEmbeddings(payload: OpenAIEmbeddingsResponse): number[][] {
  if (Array.isArray(payload.data)) {
    const rows = [...payload.data];
    if (rows.some(item => item.index !== undefined)) {
      const indices = rows.map(item => item.index);
      if (indices.some(index => !Number.isInteger(index) || index! < 0 || index! >= rows.length) || new Set(indices).size !== rows.length) {
        throw new Error('向量模型返回了无效或重复的输入索引。');
      }
      rows.sort((a, b) => a.index! - b.index!);
    }
    return rows
      .map(item => item.embedding)
      .filter((value): value is number[] => Array.isArray(value));
  }
  if (payload.data && Array.isArray(payload.data.embedding)) {
    return [payload.data.embedding];
  }
  return [];
}

async function parseEmbeddingResponse(res: Response, apiKey: string, expectedCount: number, signal?: AbortSignal): Promise<number[][]> {
  signal?.throwIfAborted();
  const rawBody = await res.text().catch(() => '');
  signal?.throwIfAborted();
  if (!res.ok) {
    const safeError = redactRuntimeAISecrets(rawBody, apiKey);
    throw new Error(`OpenAI-compatible embeddings API error: ${res.status}${safeError ? ` - ${safeError}` : ''}`);
  }

  let parsed: OpenAIEmbeddingsResponse;
  try {
    parsed = JSON.parse(rawBody) as OpenAIEmbeddingsResponse;
  } catch {
    const safeBody = redactRuntimeAISecrets(rawBody, apiKey);
    throw new Error(`OpenAI-compatible embeddings API returned invalid JSON${safeBody ? `: ${safeBody}` : ''}`);
  }

  const embeddings = extractEmbeddings(parsed);
  if (embeddings.length !== expectedCount) {
    throw new Error(`向量模型返回数量不匹配：请求 ${expectedCount} 条，返回 ${embeddings.length} 条。`);
  }
  if (embeddings.some(embedding => embedding.length === 0 || embedding.some(value => typeof value !== 'number' || !Number.isFinite(value)))) {
    throw new Error('向量模型返回了空向量或非数值向量。');
  }
  return embeddings;
}

export async function embedTexts(
  inputs: string[],
  runtimeConfig?: Partial<RuntimeAIConfig>,
  signal?: AbortSignal,
): Promise<number[][]> {
  signal?.throwIfAborted();
  const resolvedRuntimeConfig = resolveServerRuntimeAIConfig(runtimeConfig);
  if (!hasRuntimeAIProvider(resolvedRuntimeConfig)) {
    throw new Error('账号绑定的向量模型服务尚未配置，无法生成向量。');
  }

  const normalizedInputs = inputs.map(input => input.trim()).filter(Boolean);
  if (normalizedInputs.length === 0) return [];

  const endpoint = resolveOpenAIEmbeddingsEndpoint(resolvedRuntimeConfig);
  const model = resolveRuntimeEmbeddingModel(resolvedRuntimeConfig);
  if (isMultimodalEmbeddingModel(model)) {
    const embeddings: number[][] = [];
    for (const text of normalizedInputs) {
      signal?.throwIfAborted();
      const res = await fetchWithTransientRetry(endpoint, {
        method: 'POST',
        signal,
        headers: buildOpenAIHeaders(resolvedRuntimeConfig.apiKey),
        body: JSON.stringify({
          model,
          input: [{ type: 'text', text }],
        }),
      }, { label: 'openai-compatible multimodal embeddings' });
      const [embedding] = await parseEmbeddingResponse(res, resolvedRuntimeConfig.apiKey, 1, signal);
      embeddings.push(embedding);
    }
    return embeddings;
  }

  const batchSize = /^qwen3\.7-text-embedding(?:-flash)?$/.test(model) ? 20 : normalizedInputs.length;
  const embeddings: number[][] = [];
  for (let offset = 0; offset < normalizedInputs.length; offset += batchSize) {
    signal?.throwIfAborted();
    const batch = normalizedInputs.slice(offset, offset + batchSize);
    const res = await fetchWithTransientRetry(endpoint, {
      method: 'POST',
      signal,
      headers: buildOpenAIHeaders(resolvedRuntimeConfig.apiKey),
      body: JSON.stringify({ model, input: batch }),
    }, { label: 'openai-compatible embeddings' });
    const vectors = await parseEmbeddingResponse(res, resolvedRuntimeConfig.apiKey, batch.length, signal);
    const dimension = embeddings[0]?.length || vectors[0].length;
    if (vectors.some(vector => vector.length !== dimension)) {
      throw new Error('向量模型返回了不一致的向量维度。');
    }
    embeddings.push(...vectors);
  }
  return embeddings;
}
