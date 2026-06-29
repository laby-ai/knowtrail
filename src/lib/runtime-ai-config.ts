import type { RuntimeAIConfig } from '@/types';

export function sanitizeRuntimeAIConfig(value: unknown): Partial<RuntimeAIConfig> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const config = value as Partial<Record<keyof RuntimeAIConfig, unknown>>;
  return {
    apiBase: typeof config.apiBase === 'string' ? config.apiBase : '',
    apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
    model: typeof config.model === 'string' ? config.model : '',
    visionModel: typeof config.visionModel === 'string' ? config.visionModel : '',
    embeddingModel: typeof config.embeddingModel === 'string' ? config.embeddingModel : '',
    ttsSpeaker: typeof config.ttsSpeaker === 'string' ? config.ttsSpeaker : '',
  };
}

export function parseRuntimeAIConfigJson(value: string | null | undefined): Partial<RuntimeAIConfig> | undefined {
  if (!value?.trim()) return undefined;
  try {
    return sanitizeRuntimeAIConfig(JSON.parse(value));
  } catch {
    return undefined;
  }
}

export function hasRuntimeAIProvider(runtimeConfig?: Partial<RuntimeAIConfig>): runtimeConfig is RuntimeAIConfig {
  return Boolean(runtimeConfig?.apiBase?.trim() && runtimeConfig?.apiKey?.trim());
}

export function allowRequestRuntimeAIConfig(): boolean {
  return process.env.ALLOW_USER_RUNTIME_AI_CONFIG === 'true';
}

function envFirst(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return '';
}

export function serverRuntimeAIConfigFromEnv(): Partial<RuntimeAIConfig> {
  const openAICompatibleBase = envFirst('OPENAI_COMPAT_API_BASE');
  const openAICompatibleKey = envFirst('OPENAI_COMPAT_API_KEY');
  const arkBase = envFirst('ARK_API_BASE');
  const arkKey = envFirst('ARK_API_KEY');
  const openAIBase = envFirst('OPENAI_API_BASE');
  const openAIKey = envFirst('OPENAI_API_KEY');

  if (openAICompatibleBase && openAICompatibleKey) {
    return {
      apiBase: openAICompatibleBase,
      apiKey: openAICompatibleKey,
      model: envFirst('OPENAI_COMPAT_MODEL', 'ARK_MODEL'),
      visionModel: envFirst('OPENAI_COMPAT_VISION_MODEL', 'ARK_VISION_MODEL'),
      embeddingModel: envFirst('OPENAI_COMPAT_EMBEDDING_MODEL', 'ARK_EMBEDDING_MODEL'),
      ttsSpeaker: envFirst('AGENTPLAN_TTS_SPEAKER', 'DOUBAO_TTS_SPEAKER', 'ARK_TTS_SPEAKER'),
    };
  }

  if (arkBase && arkKey) {
    return {
      apiBase: arkBase,
      apiKey: arkKey,
      model: envFirst('ARK_MODEL', 'OPENAI_COMPAT_MODEL'),
      visionModel: envFirst('ARK_VISION_MODEL', 'OPENAI_COMPAT_VISION_MODEL'),
      embeddingModel: envFirst('ARK_EMBEDDING_MODEL', 'OPENAI_COMPAT_EMBEDDING_MODEL'),
      ttsSpeaker: envFirst('AGENTPLAN_TTS_SPEAKER', 'DOUBAO_TTS_SPEAKER', 'ARK_TTS_SPEAKER'),
    };
  }

  if (openAIBase && openAIKey) {
    return {
      apiBase: openAIBase,
      apiKey: openAIKey,
      model: envFirst('OPENAI_COMPAT_MODEL', 'ARK_MODEL'),
      visionModel: envFirst('OPENAI_COMPAT_VISION_MODEL', 'ARK_VISION_MODEL'),
      embeddingModel: envFirst('OPENAI_COMPAT_EMBEDDING_MODEL', 'ARK_EMBEDDING_MODEL'),
      ttsSpeaker: envFirst('AGENTPLAN_TTS_SPEAKER', 'DOUBAO_TTS_SPEAKER', 'ARK_TTS_SPEAKER'),
    };
  }

  return {
    apiBase: envFirst('OPENAI_COMPAT_API_BASE', 'ARK_API_BASE', 'OPENAI_API_BASE'),
    apiKey: envFirst('OPENAI_COMPAT_API_KEY', 'ARK_API_KEY', 'OPENAI_API_KEY'),
    model: envFirst('OPENAI_COMPAT_MODEL', 'ARK_MODEL'),
    visionModel: envFirst('OPENAI_COMPAT_VISION_MODEL', 'ARK_VISION_MODEL'),
    embeddingModel: envFirst('OPENAI_COMPAT_EMBEDDING_MODEL', 'ARK_EMBEDDING_MODEL'),
    ttsSpeaker: envFirst('AGENTPLAN_TTS_SPEAKER', 'DOUBAO_TTS_SPEAKER', 'ARK_TTS_SPEAKER'),
  };
}

export function resolveServerRuntimeAIConfig(input?: Partial<RuntimeAIConfig>): Partial<RuntimeAIConfig> {
  if (allowRequestRuntimeAIConfig() && hasRuntimeAIProvider(input)) return input;
  return serverRuntimeAIConfigFromEnv();
}

function normalizeOpenAIBase(apiBase: string): string {
  const trimmed = apiBase.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed.slice(0, -'/chat/completions'.length);
  if (/\/v\d+$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

function openAIChatEndpoint(apiBase: string): string {
  const trimmed = apiBase.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  return `${normalizeOpenAIBase(apiBase)}/chat/completions`;
}

function isMultimodalEmbeddingModel(model?: string): boolean {
  return /embedding-vision/i.test(model || '');
}

function openAIEmbeddingsEndpoint(apiBase: string, embeddingModel?: string): string {
  const trimmed = apiBase.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/embeddings/multimodal')) return trimmed;
  if (trimmed.endsWith('/embeddings')) return trimmed;
  if (trimmed.endsWith('/chat/completions')) return `${trimmed.slice(0, -'/chat/completions'.length)}/embeddings`;
  const suffix = isMultimodalEmbeddingModel(embeddingModel) ? '/embeddings/multimodal' : '/embeddings';
  return `${normalizeOpenAIBase(apiBase)}${suffix}`;
}

function isPrivateIPv4(hostname: string): boolean {
  const parts = hostname.split('.').map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0
  );
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    (normalized.includes(':') && (
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80')
    )) ||
    isPrivateIPv4(normalized)
  );
}

export function resolveOpenAIChatEndpoint(runtimeConfig?: Partial<RuntimeAIConfig>): string {
  if (!hasRuntimeAIProvider(runtimeConfig)) {
    throw new Error('账号绑定的模型服务尚未配置，请稍后再试。');
  }

  let endpoint: URL;
  try {
    endpoint = new URL(openAIChatEndpoint(runtimeConfig.apiBase));
  } catch {
    throw new Error('模型服务地址配置不正确，请联系部署方处理。');
  }

  if (!['https:', 'http:'].includes(endpoint.protocol)) {
    throw new Error('模型网关地址仅支持 http 或 https 协议。');
  }

  const allowInsecure = process.env.ALLOW_INSECURE_API_BASE === 'true' || process.env.NODE_ENV !== 'production';
  if (endpoint.protocol === 'http:' && !allowInsecure) {
    throw new Error('公网部署默认只允许 HTTPS 模型网关。如确需 HTTP 内网网关，请显式设置 ALLOW_INSECURE_API_BASE=true。');
  }

  const allowPrivate = process.env.ALLOW_PRIVATE_API_BASE === 'true' || process.env.NODE_ENV !== 'production';
  if (isPrivateOrLocalHost(endpoint.hostname) && !allowPrivate) {
    throw new Error('公网部署默认禁止把模型网关指向 localhost 或私有网段，避免服务端被当作内网代理。');
  }

  return endpoint.toString().replace(/\/$/, '');
}

export function resolveOpenAIEmbeddingsEndpoint(runtimeConfig?: Partial<RuntimeAIConfig>): string {
  if (!hasRuntimeAIProvider(runtimeConfig)) {
    throw new Error('账号绑定的模型服务尚未配置，请稍后再试。');
  }

  let endpoint: URL;
  try {
    endpoint = new URL(openAIEmbeddingsEndpoint(runtimeConfig.apiBase, runtimeConfig.embeddingModel));
  } catch {
    throw new Error('模型服务地址配置不正确，请联系部署方处理。');
  }

  if (!['https:', 'http:'].includes(endpoint.protocol)) {
    throw new Error('模型网关地址仅支持 http 或 https 协议。');
  }

  const allowInsecure = process.env.ALLOW_INSECURE_API_BASE === 'true' || process.env.NODE_ENV !== 'production';
  if (endpoint.protocol === 'http:' && !allowInsecure) {
    throw new Error('公网部署默认只允许 HTTPS 模型网关。如确需 HTTP 内网网关，请显式设置 ALLOW_INSECURE_API_BASE=true。');
  }

  const allowPrivate = process.env.ALLOW_PRIVATE_API_BASE === 'true' || process.env.NODE_ENV !== 'production';
  if (isPrivateOrLocalHost(endpoint.hostname) && !allowPrivate) {
    throw new Error('公网部署默认禁止把模型网关指向 localhost 或私有网段，避免服务端被当作内网代理。');
  }

  return endpoint.toString().replace(/\/$/, '');
}

export function redactRuntimeAISecrets(text: string, apiKey?: string): string {
  let redacted = text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/"api[_-]?key"\s*:\s*"[^"]+"/gi, '"apiKey":"[REDACTED]"')
    .replace(/"authorization"\s*:\s*"[^"]+"/gi, '"authorization":"[REDACTED]"');

  const key = apiKey?.trim();
  if (key) {
    redacted = redacted.split(key).join('[REDACTED]');
  }

  return redacted.slice(0, 500);
}
