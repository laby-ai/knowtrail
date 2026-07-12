export type ZhiqiModelScene = 'paper_reading' | 'paper_embedding';

export interface ZhiqiResolvedModel {
  model: string;
  modelType: number;
  apiKey: string;
  apiBase: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ZhiqiModelResolverHealth {
  configured: boolean;
  reachable: boolean;
  textModelReady: boolean;
  embeddingModelReady: boolean;
  ready: boolean;
  status: 'not-configured' | 'unreachable' | 'partial' | 'ready';
}

interface CommonResult<T> {
  code?: unknown;
  data?: T;
}

interface ModelResolveData {
  model?: unknown;
  modelType?: unknown;
  apiKey?: unknown;
  url?: unknown;
  temperature?: unknown;
  maxTokens?: unknown;
}

function resolverEndpoint(): URL | undefined {
  const raw = process.env.ZHIQI_MODEL_RESOLVE_URL?.trim();
  if (!raw) return undefined;
  const endpoint = new URL(raw);
  if (!['http:', 'https:'].includes(endpoint.protocol)) {
    throw new Error('ZHIQI_MODEL_RESOLVE_URL must use http or https.');
  }
  return endpoint;
}

function requestTimeoutMs(): number {
  const configured = Number(process.env.ZHIQI_MODEL_RESOLVE_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured < 500 || configured > 10_000) return 3_000;
  return Math.floor(configured);
}

function modelFromResponse(value: unknown): ZhiqiResolvedModel | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const result = value as CommonResult<ModelResolveData>;
  if (result.code !== 0 || !result.data || typeof result.data !== 'object') return undefined;
  const data = result.data;
  if (
    typeof data.model !== 'string' || !data.model.trim() ||
    typeof data.modelType !== 'number' ||
    typeof data.apiKey !== 'string' || !data.apiKey.trim() ||
    typeof data.url !== 'string' || !data.url.trim()
  ) {
    return undefined;
  }
  return {
    model: data.model.trim(),
    modelType: data.modelType,
    apiKey: data.apiKey.trim(),
    apiBase: data.url.trim(),
    temperature: typeof data.temperature === 'number' ? data.temperature : undefined,
    maxTokens: typeof data.maxTokens === 'number' ? data.maxTokens : undefined,
  };
}

export async function resolveZhiqiRuntimeModel(scene: ZhiqiModelScene): Promise<ZhiqiResolvedModel | undefined> {
  const endpoint = resolverEndpoint();
  if (!endpoint) return undefined;
  endpoint.searchParams.set('scene', scene);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs());
  const token = process.env.ZHIQI_SERVICE_TOKEN?.trim();
  try {
    const response = await fetch(endpoint, {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Zhiqi model resolver returned HTTP ${response.status}.`);
    return modelFromResponse(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

export async function getZhiqiModelResolverHealth(): Promise<ZhiqiModelResolverHealth> {
  let configured = false;
  try {
    configured = Boolean(resolverEndpoint());
  } catch {
    return unavailableHealth(true, 'unreachable');
  }
  if (!configured) return unavailableHealth(false, 'not-configured');

  try {
    const [textModel, embeddingModel] = await Promise.all([
      resolveZhiqiRuntimeModel('paper_reading'),
      resolveZhiqiRuntimeModel('paper_embedding'),
    ]);
    const textModelReady = textModel?.modelType === 1;
    const embeddingModelReady = embeddingModel?.modelType === 5;
    const ready = textModelReady && embeddingModelReady;
    return {
      configured: true,
      reachable: true,
      textModelReady,
      embeddingModelReady,
      ready,
      status: ready ? 'ready' : 'partial',
    };
  } catch {
    return unavailableHealth(true, 'unreachable');
  }
}

function unavailableHealth(
  configured: boolean,
  status: 'not-configured' | 'unreachable',
): ZhiqiModelResolverHealth {
  return {
    configured,
    reachable: false,
    textModelReady: false,
    embeddingModelReady: false,
    ready: false,
    status,
  };
}
