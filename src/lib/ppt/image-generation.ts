// Shared slide image generation helpers. Bailian is the primary production
// provider; SitianAI and OpenAI-compatible routes remain compatibility paths.
import { setTimeout as delay } from 'node:timers/promises';
import type { RuntimeAIConfig } from '@/types';
import { allowRequestRuntimeAIConfig, hasRuntimeAIProvider, redactRuntimeAISecrets } from '@/lib/runtime-ai-config';
import {
  buildReferenceImageInput,
  parseSlideReferenceImage,
  SlideImageProviderError,
} from '@/lib/ppt/slide-image-contract';

function sitianApiBase(): string {
  return process.env.SITIAN_API_BASE?.trim() || 'https://images.sitianai.com';
}

function sitianApiToken(): string {
  return process.env.SITIAN_API_TOKEN?.trim() || '';
}

function sitianImageProviderRequired(): boolean {
  return process.env.SITIAN_IMAGE_PROVIDER_REQUIRED === 'true';
}

interface SitianResponse {
  success: boolean;
  candidates?: Array<{ index: number; images?: Array<{ mimeType: string; data: string }> }>;
}

interface OpenAIImageResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message?: string };
}

interface BailianImageResponse {
  output?: {
    choices?: Array<{
      message?: {
        content?: Array<{ image?: string }>;
      };
    }>;
  };
  code?: string;
  message?: string;
}

function envFirst(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return '';
}

function bailianApiKey(): string {
  return envFirst('DASHSCOPE_API_KEY');
}

function bailianImageApiBase(): string {
  return envFirst('DASHSCOPE_IMAGE_API_BASE') || 'https://dashscope.aliyuncs.com/api/v1';
}

function bailianImageModel(): string {
  return envFirst('DASHSCOPE_IMAGE_MODEL') || 'qwen-image-2.0';
}

function bailianImageSize(aspectRatio?: string): string {
  if (aspectRatio === '4:3') return '2368*1728';
  if (aspectRatio === '1:1') return '2048*2048';
  return '2688*1536';
}

export function resolveImageRuntimeConfig(input?: Partial<RuntimeAIConfig>): Partial<RuntimeAIConfig> {
  if (allowRequestRuntimeAIConfig() && hasRuntimeAIProvider(input)) return input;
  return {
    apiBase: envFirst('OPENAI_COMPAT_API_BASE', 'ARK_API_BASE', 'OPENAI_API_BASE'),
    apiKey: envFirst('OPENAI_COMPAT_API_KEY', 'ARK_API_KEY', 'OPENAI_API_KEY'),
    model: envFirst('OPENAI_COMPAT_MODEL', 'ARK_MODEL'),
    visionModel: envFirst('OPENAI_COMPAT_VISION_MODEL', 'OPENAI_COMPAT_IMAGE_MODEL', 'ARK_IMAGE_MODEL', 'ARK_VISION_MODEL'),
  };
}

function normalizeOpenAIImageEndpoint(apiBase: string): string {
  const trimmed = apiBase.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/images/generations')) return trimmed;
  if (trimmed.endsWith('/chat/completions')) return `${trimmed.slice(0, -'/chat/completions'.length)}/images/generations`;
  if (trimmed.endsWith('/embeddings')) return `${trimmed.slice(0, -'/embeddings'.length)}/images/generations`;
  if (/\/v\d+$/i.test(trimmed)) return `${trimmed}/images/generations`;
  return `${trimmed}/v1/images/generations`;
}

function resolveImageApiBase(runtimeConfig: Partial<RuntimeAIConfig>): string {
  const explicit = envFirst('OPENAI_COMPAT_IMAGE_API_BASE', 'ARK_IMAGE_API_BASE');
  if (explicit) return explicit;
  const base = runtimeConfig.apiBase || '';
  return base.replace(/\/api\/plan\/v(\d+)\/?$/i, '/api/v$1');
}

function resolveImageApiKey(runtimeConfig: Partial<RuntimeAIConfig>): string {
  return envFirst('OPENAI_COMPAT_IMAGE_API_KEY', 'ARK_IMAGE_API_KEY')
    || runtimeConfig.apiKey
    || envFirst('ARK_AGENTPLAN_API_KEY');
}

function resolveImageModel(runtimeConfig?: Partial<RuntimeAIConfig>): string {
  const explicitImageModel = envFirst('OPENAI_COMPAT_IMAGE_MODEL', 'ARK_IMAGE_MODEL');
  if (explicitImageModel) return explicitImageModel;
  const candidate = runtimeConfig?.visionModel?.trim() || envFirst('OPENAI_COMPAT_VISION_MODEL', 'ARK_VISION_MODEL');
  if (/seedream|image|imagen|dall-e|gpt-image/i.test(candidate)) return candidate;
  return 'doubao-seedream-5-0-lite-260128';
}

function imageSizeForAspectRatio(aspectRatio?: string): string {
  if (aspectRatio === '4:3') return '2560x1920';
  if (aspectRatio === '1:1') return '2048x2048';
  return '2560x1440';
}

function imageRequestSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

async function imageUrlToBase64(url: string, apiKey?: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    signal: imageRequestSignal(Number(process.env.PPT_IMAGE_FETCH_TIMEOUT_MS || 60_000), signal),
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    throw new Error(`图片 URL 下载失败:HTTP ${response.status}${raw ? ` - ${redactRuntimeAISecrets(raw, apiKey)}` : ''}`);
  }
  return Buffer.from(await response.arrayBuffer()).toString('base64');
}

async function generateBailianImage(prompt: string, options?: {
  aspectRatio?: string;
  negativePrompt?: string;
  referenceImageBase64?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const apiKey = bailianApiKey();
  const endpoint = bailianImageApiBase().replace(/\/+$/, '')
    + '/services/aigc/multimodal-generation/generation';
  const content: Array<Record<string, string>> = [];
  if (options?.referenceImageBase64) {
    content.push({ image: parseSlideReferenceImage(options.referenceImageBase64).dataUrl });
  }
  content.push({ text: prompt });

  const signal = imageRequestSignal(Number(process.env.PPT_IMAGE_TIMEOUT_MS || 180_000), options?.signal);
  const requestBody = JSON.stringify({
    model: bailianImageModel(),
    input: { messages: [{ role: 'user', content }] },
    parameters: {
      negative_prompt: options?.negativePrompt || undefined,
      size: bailianImageSize(options?.aspectRatio),
      n: 1,
      prompt_extend: true,
      watermark: false,
    },
  });

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: requestBody,
      signal,
    });
    const rawBody = await response.text().catch(() => '');
    let parsed: BailianImageResponse;
    try {
      parsed = JSON.parse(rawBody) as BailianImageResponse;
    } catch {
      throw new Error('百炼图像服务返回非 JSON:' + redactRuntimeAISecrets(rawBody.slice(0, 300), apiKey));
    }
    if (!response.ok) {
      const detail = parsed.message || parsed.code || rawBody;
      const permanentLimit = /BudgetLimitExceeded|BillOverdue|CommodityNotPurchased|Free allocated quota/i.test(`${parsed.code || ''} ${parsed.message || ''}`);
      if (response.status === 429 && !permanentLimit && attempt < 2) {
        const retryAfter = response.headers.get('retry-after');
        const headerDelay = retryAfter
          ? (Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now())
          : 0;
        const delayMs = Math.max(2000 * 4 ** attempt, Number.isFinite(headerDelay) ? headerDelay : 0);
        if (delayMs <= 30_000) {
          console.warn(`[PPT image] Provider busy; retry ${attempt + 1}/2 after ${delayMs}ms`);
          await delay(delayMs, undefined, { signal });
          continue;
        }
      }
      throw new SlideImageProviderError(
        response.status,
        '百炼图像服务失败:HTTP ' + response.status
          + (detail ? ' - ' + redactRuntimeAISecrets(detail, apiKey) : ''),
      );
    }

    const image = parsed.output?.choices?.[0]?.message?.content?.find(item => item.image)?.image;
    if (!image) throw new Error('百炼图像服务未返回图片。');
    return imageUrlToBase64(image, apiKey, signal);
  }
}

async function generateSitianImage(prompt: string, options?: {
  aspectRatio?: string;
  negativePrompt?: string;
  referenceImageBase64?: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  try {
    const body: Record<string, unknown> = {
      prompt,
      aspectRatio: options?.aspectRatio || '16:9',
      numberOfImages: 1,
      outputMimeType: 'image/png',
      addWatermark: false,
    };
    if (options?.negativePrompt) body.negativePrompt = options.negativePrompt;
    if (options?.referenceImageBase64) {
      body.imageBase64 = options.referenceImageBase64;
      body.imageMimeType = 'image/png';
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = sitianApiToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const resp = await fetch(`${sitianApiBase()}/api/generate`, {
      method: 'POST', headers, body: JSON.stringify(body),
      signal: imageRequestSignal(120_000, options?.signal),
    });
    if (!resp.ok) { console.error(`[SitianAI] HTTP ${resp.status}`); return null; }

    const data: SitianResponse = await resp.json();
    if (!data.success) return null;
    return data.candidates?.[0]?.images?.[0]?.data || null;
  } catch (err) {
    if (options?.signal?.aborted) throw err;
    console.error('[SitianAI] Generate error:', err);
    return null;
  }
}

async function generateOpenAICompatibleImage(
  prompt: string,
  runtimeConfig: Partial<RuntimeAIConfig>,
  options?: { aspectRatio?: string; negativePrompt?: string; referenceImageBase64?: string; signal?: AbortSignal },
): Promise<string> {
  if (!hasRuntimeAIProvider(runtimeConfig)) {
    throw new Error('账号绑定的图片模型服务尚未配置,请稍后再试。');
  }

  const endpoint = normalizeOpenAIImageEndpoint(resolveImageApiBase(runtimeConfig));
  const apiKey = resolveImageApiKey(runtimeConfig);
  const model = resolveImageModel(runtimeConfig);
  const size = imageSizeForAspectRatio(options?.aspectRatio);
  const promptWithGuards = [
    prompt,
    options?.negativePrompt ? `\nNegative prompt: ${options.negativePrompt}` : '',
  ].join('');

  const requestBody: Record<string, unknown> = {
    model,
    prompt: promptWithGuards,
    size,
    response_format: 'b64_json',
    watermark: false,
  };
  if (options?.referenceImageBase64) {
    requestBody.image = buildReferenceImageInput(
      parseSlideReferenceImage(options.referenceImageBase64),
      endpoint,
      model,
    );
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal: imageRequestSignal(Number(process.env.PPT_IMAGE_TIMEOUT_MS || 180_000), options?.signal),
  });

  const rawBody = await response.text().catch(() => '');
  if (!response.ok) {
    throw new SlideImageProviderError(
      response.status,
      `图片模型 API 失败:HTTP ${response.status}${rawBody ? ` - ${redactRuntimeAISecrets(rawBody, apiKey)}` : ''}`,
    );
  }

  let parsed: OpenAIImageResponse;
  try {
    parsed = JSON.parse(rawBody) as OpenAIImageResponse;
  } catch {
    throw new Error(`图片模型返回非 JSON:${redactRuntimeAISecrets(rawBody.slice(0, 300), apiKey)}`);
  }

  const first = parsed.data?.[0];
  if (first?.b64_json) return first.b64_json;
  if (first?.url) return imageUrlToBase64(first.url, apiKey, options?.signal);
  const message = parsed.error?.message ? redactRuntimeAISecrets(parsed.error.message, apiKey) : '';
  throw new Error(`图片模型未返回图片数据${message ? `:${message}` : ''}`);
}

export async function generateSlideImage(prompt: string, options?: {
  aspectRatio?: string;
  negativePrompt?: string;
  referenceImageBase64?: string;
  runtimeConfig?: Partial<RuntimeAIConfig>;
  signal?: AbortSignal;
}): Promise<string | null> {
  if (bailianApiKey()) return generateBailianImage(prompt, options);
  if (sitianApiToken()) {
    const result = await generateSitianImage(prompt, options);
    if (result) return result;
    if (sitianImageProviderRequired()) {
      throw new SlideImageProviderError(502, '指定的科研图像服务暂时不可用，请稍后重试。');
    }
    console.log('[生图] 思坦AI失败,改用 OpenAI-compatible 图片模型...');
  }
  return generateOpenAICompatibleImage(prompt, resolveImageRuntimeConfig(options?.runtimeConfig), options);
}

export function resolveImageModelName(runtimeConfig?: Partial<RuntimeAIConfig>): string {
  if (bailianApiKey()) return bailianImageModel();
  return resolveImageModel(resolveImageRuntimeConfig(runtimeConfig));
}
