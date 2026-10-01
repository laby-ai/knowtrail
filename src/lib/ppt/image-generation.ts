// Shared slide image generation helpers (SitianAI first, OpenAI-compatible
// fallback). Extracted for reuse by slide revision; the original /api/ai/ppt
// route keeps its local copy to stay untouched.
import type { RuntimeAIConfig } from '@/types';
import { allowRequestRuntimeAIConfig, hasRuntimeAIProvider, redactRuntimeAISecrets } from '@/lib/runtime-ai-config';
import {
  buildReferenceImageInput,
  parseSlideReferenceImage,
  SlideImageProviderError,
} from '@/lib/ppt/slide-image-contract';
import { bailianProfileFromRuntimeConfig } from '@/lib/bailian-provider-profile';
import { generateBailianWanImage } from '@/lib/bailian-wan-image';

const SITIAN_API_BASE = process.env.SITIAN_API_BASE || 'http://images.sitianai.com';
const SITIAN_API_TOKEN = process.env.SITIAN_API_TOKEN || '';

interface SitianResponse {
  success: boolean;
  candidates?: Array<{ index: number; images?: Array<{ mimeType: string; data: string }> }>;
}

interface OpenAIImageResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message?: string };
}

function envFirst(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return '';
}

export function resolveImageRuntimeConfig(input?: Partial<RuntimeAIConfig>): Partial<RuntimeAIConfig> {
  if (allowRequestRuntimeAIConfig() && hasRuntimeAIProvider(input)) return input;
  return {
    apiBase: envFirst('OPENAI_COMPAT_API_BASE', 'ARK_API_BASE', 'OPENAI_API_BASE', 'DASHSCOPE_API_BASE'),
    apiKey: envFirst('OPENAI_COMPAT_API_KEY', 'ARK_API_KEY', 'OPENAI_API_KEY', 'DASHSCOPE_API_KEY'),
    model: envFirst('OPENAI_COMPAT_MODEL', 'ARK_MODEL', 'DASHSCOPE_MODEL'),
    visionModel: envFirst('OPENAI_COMPAT_VISION_MODEL', 'OPENAI_COMPAT_IMAGE_MODEL', 'ARK_IMAGE_MODEL', 'ARK_VISION_MODEL', 'DASHSCOPE_IMAGE_MODEL'),
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
    if (SITIAN_API_TOKEN) headers['Authorization'] = `Bearer ${SITIAN_API_TOKEN}`;

    const resp = await fetch(`${SITIAN_API_BASE}/api/generate`, {
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

const DASHSCOPE_IMAGE_API = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis';
const DASHSCOPE_TASK_API = 'https://dashscope.aliyuncs.com/api/v1/tasks';

function isDashScopeEndpoint(apiBase: string): boolean {
  return /dashscope\.aliyuncs\.com/i.test(apiBase);
}

function dashScopeSizeForAspectRatio(aspectRatio?: string): string {
  if (aspectRatio === '4:3') return '1024*768';
  if (aspectRatio === '1:1') return '1024*1024';
  return '1280*720';
}

async function generateDashScopeNativeImage(
  prompt: string,
  apiKey: string,
  options?: { aspectRatio?: string; negativePrompt?: string; signal?: AbortSignal },
): Promise<string> {
  const model = envFirst('DASHSCOPE_IMAGE_MODEL', 'OPENAI_COMPAT_IMAGE_MODEL', 'ARK_IMAGE_MODEL') || 'wanx2.1-t2i-turbo';
  const size = dashScopeSizeForAspectRatio(options?.aspectRatio);

  const submitBody = {
    model,
    input: {
      prompt,
      ...(options?.negativePrompt ? { negative_prompt: options.negativePrompt } : {}),
    },
    parameters: { n: 1, size, prompt_extend: Boolean(options?.negativePrompt), watermark: false },
  };

  const submitResp = await fetch(DASHSCOPE_IMAGE_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify(submitBody),
    signal: imageRequestSignal(30_000, options?.signal),
  });

  const submitRaw = await submitResp.text().catch(() => '');
  if (!submitResp.ok) {
    throw new SlideImageProviderError(
      submitResp.status,
      `DashScope 图片生成提交失败:HTTP ${submitResp.status}${submitRaw ? ` - ${redactRuntimeAISecrets(submitRaw, apiKey)}` : ''}`,
    );
  }

  let submitData: { output?: { task_id?: string; task_status?: string }; code?: string; message?: string };
  try { submitData = JSON.parse(submitRaw); } catch {
    throw new Error(`DashScope 图片提交返回非 JSON:${redactRuntimeAISecrets(submitRaw.slice(0, 300), apiKey)}`);
  }

  const taskId = submitData.output?.task_id;
  if (!taskId) {
    throw new Error(`DashScope 图片提交未返回 task_id${submitData.code ? `:${submitData.code}` : ''}`);
  }

  const pollDeadline = Date.now() + Number(process.env.PPT_IMAGE_TIMEOUT_MS || 180_000);
  while (Date.now() < pollDeadline) {
    if (options?.signal?.aborted) throw new Error('图片生成已取消');

    const pollResp = await fetch(`${DASHSCOPE_TASK_API}/${taskId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: imageRequestSignal(15_000, options?.signal),
    });
    if (!pollResp.ok) {
      console.error(`[DashScope] Task poll HTTP ${pollResp.status}`);
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }

    const pollData: {
      output?: { task_status?: string; results?: Array<{ url?: string }>; task_metrics?: { total?: number; succeeded?: number; failed?: number } };
    } = await pollResp.json();

    const status = pollData.output?.task_status;
    if (status === 'SUCCEEDED') {
      const imageUrl = pollData.output?.results?.[0]?.url;
      if (!imageUrl) throw new Error('DashScope 图片生成成功但未返回图片 URL');
      return imageUrlToBase64(imageUrl, apiKey, options?.signal);
    }
    if (status === 'FAILED') {
      throw new Error(`DashScope 图片生成任务失败:${JSON.stringify(pollData.output?.task_metrics || {})}`);
    }

    await new Promise(r => setTimeout(r, 3000));
  }

  throw new Error('DashScope 图片生成超时');
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
  const memberProfile = bailianProfileFromRuntimeConfig(options?.runtimeConfig || {});
  if (memberProfile) {
    const image = await generateBailianWanImage(prompt, memberProfile, {
      aspectRatio: options?.aspectRatio,
      signal: options?.signal,
    });
    return image.toString('base64');
  }
  if (SITIAN_API_TOKEN) {
    const result = await generateSitianImage(prompt, options);
    if (result) return result;
    console.log('[生图] 思坦AI失败,改用其他图片模型...');
  }
  const resolvedConfig = resolveImageRuntimeConfig(options?.runtimeConfig);
  const apiBase = resolveImageApiBase(resolvedConfig);
  const apiKey = resolveImageApiKey(resolvedConfig);
  if (apiKey && isDashScopeEndpoint(apiBase)) {
    return generateDashScopeNativeImage(prompt, apiKey, {
      aspectRatio: options?.aspectRatio,
      negativePrompt: options?.negativePrompt,
      signal: options?.signal,
    });
  }
  return generateOpenAICompatibleImage(prompt, resolvedConfig, options);
}

export function resolveImageModelName(runtimeConfig?: Partial<RuntimeAIConfig>): string {
  return resolveImageModel(resolveImageRuntimeConfig(runtimeConfig));
}
