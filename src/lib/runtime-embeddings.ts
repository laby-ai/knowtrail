import type { RuntimeAIConfig } from '@/types';
import {
  allowRequestRuntimeAIConfig,
  hasRuntimeAIProvider,
  redactRuntimeAISecrets,
  resolveOpenAIEmbeddingsEndpoint,
  resolveServerRuntimeAIConfig,
} from '@/lib/runtime-ai-config';
import { buildOpenAIHeaders, fetchWithTransientRetry } from '@/lib/runtime-ai-http';
import {
  isZhiqiModelResolverConfigured,
  resolveZhiqiRuntimeModel,
} from '@/lib/zhiqi-model-resolver';

interface OpenAIEmbeddingsResponse {
  data?: Array<{ embedding?: number[] }> | { embedding?: number[] };
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
    return payload.data
      .map(item => item.embedding)
      .filter((value): value is number[] => Array.isArray(value));
  }
  if (payload.data && Array.isArray(payload.data.embedding)) {
    return [payload.data.embedding];
  }
  return [];
}

async function parseEmbeddingResponse(res: Response, apiKey: string, expectedCount: number): Promise<number[][]> {
  const rawBody = await res.text().catch(() => '');
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
): Promise<number[][]> {
  const resolvedRuntimeConfig = await resolveRuntimeEmbeddingConfig(runtimeConfig);
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
      const res = await fetchWithTransientRetry(endpoint, {
        method: 'POST',
        headers: buildOpenAIHeaders(resolvedRuntimeConfig.apiKey),
        body: JSON.stringify({
          model,
          input: [{ type: 'text', text }],
        }),
      }, { label: 'openai-compatible multimodal embeddings' });
      const [embedding] = await parseEmbeddingResponse(res, resolvedRuntimeConfig.apiKey, 1);
      embeddings.push(embedding);
    }
    return embeddings;
  }

  const res = await fetchWithTransientRetry(endpoint, {
    method: 'POST',
    headers: buildOpenAIHeaders(resolvedRuntimeConfig.apiKey),
    body: JSON.stringify({
      model,
      input: normalizedInputs,
    }),
  }, { label: 'openai-compatible embeddings' });
  return parseEmbeddingResponse(res, resolvedRuntimeConfig.apiKey, normalizedInputs.length);
}

async function resolveRuntimeEmbeddingConfig(
  runtimeConfig?: Partial<RuntimeAIConfig>,
): Promise<Partial<RuntimeAIConfig>> {
  if (allowRequestRuntimeAIConfig() && hasRuntimeAIProvider(runtimeConfig)) {
    return resolveServerRuntimeAIConfig(runtimeConfig);
  }

  if (!isZhiqiModelResolverConfigured()) {
    return resolveServerRuntimeAIConfig(runtimeConfig);
  }

  const resolved = await resolveZhiqiRuntimeModel('paper_embedding');
  if (!resolved || resolved.modelType !== 5) {
    throw new Error('统一模型管理尚未配置论文向量模型，无法生成向量。');
  }
  return {
    apiBase: resolved.apiBase,
    apiKey: resolved.apiKey,
    embeddingModel: resolved.model,
  };
}
