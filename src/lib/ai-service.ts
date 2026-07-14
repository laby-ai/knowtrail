import type { RuntimeAIConfig } from '@/types';
import {
  allowRequestRuntimeAIConfig,
  hasRuntimeAIProvider,
  redactRuntimeAISecrets,
  resolveOpenAIChatEndpoint,
  resolveServerRuntimeAIConfig,
} from '@/lib/runtime-ai-config';
import { buildOpenAIHeaders, fetchWithTransientRetry, shouldRetryTransientError, waitForTransientRetry } from '@/lib/runtime-ai-http';
import { isZhiqiModelResolverConfigured, resolveZhiqiRuntimeModel } from '@/lib/zhiqi-model-resolver';
export { embedTexts } from '@/lib/runtime-embeddings';
import { resolveFileUrl, storeFile } from '@/lib/storage';
import {
  generateVolcenginePodcast,
  isVolcenginePodcastConfigured,
  redactVolcenginePodcastSecret,
} from '@/lib/volcengine-podcast';
import { synthesizeDoubaoAgentPlanTts } from '@/lib/doubao-agentplan-tts';

export type Message = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
};

type RuntimeLLMOptions = {
  model?: string;
  temperature?: number;
  thinking?: 'enabled' | 'disabled';
  vision?: boolean;
  maxTokens?: number;
  signal?: AbortSignal;
};

type PodcastProvider = 'volcengine-podcast-ws-v3' | 'doubao-tts-v3';
type PodcastAudioProviderPreference = 'auto' | 'doubao-tts' | 'volcengine-podcast';
export type PodcastErrorType =
  | 'auth'
  | 'permission'
  | 'rate_limit'
  | 'timeout'
  | 'invalid_request'
  | 'configuration'
  | 'upstream'
  | 'unknown';

export type PodcastGenerationFailure = {
  errorType: PodcastErrorType;
  error: string;
  userMessage: string;
  retryable: boolean;
  requestId?: string;
  upstreamStatus?: number;
};

export class PodcastAudioGenerationError extends Error {
  dialogueText: string;
  segments?: PodcastAudioSegment[];

  constructor(message: string, dialogueText: string, options?: ErrorOptions & { segments?: PodcastAudioSegment[] }) {
    super(message, options);
    this.name = 'PodcastAudioGenerationError';
    this.dialogueText = dialogueText;
    this.segments = options?.segments;
  }
}

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
    delta?: {
      content?: string;
    };
  }>;
}

function extractOpenAIContent(payload: OpenAIChatCompletionResponse): string {
  return payload.choices
    ?.map(choice => choice.message?.content || choice.delta?.content || '')
    .join('') || '';
}

function resolveRuntimeModel(options?: RuntimeLLMOptions, runtimeConfig?: Partial<RuntimeAIConfig>): string {
  if (options?.vision && runtimeConfig?.visionModel?.trim()) return runtimeConfig.visionModel.trim();
  if (runtimeConfig?.model?.trim()) return runtimeConfig.model.trim();
  if (options?.model?.trim()) return options.model.trim();
  return process.env.OPENAI_COMPAT_MODEL || 'gpt-4o-mini';
}

async function resolveRuntimeTextConfig(
  runtimeConfig?: Partial<RuntimeAIConfig>,
  options?: RuntimeLLMOptions,
): Promise<Partial<RuntimeAIConfig>> {
  if (allowRequestRuntimeAIConfig() && hasRuntimeAIProvider(runtimeConfig)) return runtimeConfig;

  // The managed paper scene is text-only. Vision calls keep their dedicated server configuration.
  if (options?.vision || !isZhiqiModelResolverConfigured()) {
    return resolveServerRuntimeAIConfig(runtimeConfig);
  }

  const resolved = await resolveZhiqiRuntimeModel('paper_reading');
  if (!resolved || resolved.modelType !== 1) {
    throw new Error('统一模型管理中的论文精读文本模型尚未配置。');
  }
  return {
    apiBase: resolved.apiBase,
    apiKey: resolved.apiKey,
    model: resolved.model,
  };
}

async function* openAICompatStream(
  messages: Message[],
  options?: RuntimeLLMOptions,
  runtimeConfig?: Partial<RuntimeAIConfig>,
): AsyncGenerator<string, void, unknown> {
  if (!hasRuntimeAIProvider(runtimeConfig)) {
    throw new Error('账号绑定的模型服务尚未配置。');
  }

  const endpoint = resolveOpenAIChatEndpoint(runtimeConfig);
  const maxTokens = options?.maxTokens;
  const maxTokensPayload = typeof maxTokens === 'number' && Number.isInteger(maxTokens) && maxTokens > 0
    ? { max_tokens: maxTokens }
    : {};
  const res = await fetchWithTransientRetry(endpoint, {
    method: 'POST',
    headers: buildOpenAIHeaders(runtimeConfig.apiKey),
    signal: options?.signal,
    body: JSON.stringify({
      model: resolveRuntimeModel(options, runtimeConfig),
      messages,
      temperature: options?.temperature ?? 0.7,
      ...maxTokensPayload,
      stream: true,
    }),
  }, { label: 'openai-compatible chat' });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    const safeError = redactRuntimeAISecrets(errText, runtimeConfig.apiKey);
    throw new Error(`OpenAI-compatible API error: ${res.status}${safeError ? ` - ${safeError}` : ''}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    const rawBody = await res.text();
    try {
      const content = extractOpenAIContent(JSON.parse(rawBody) as OpenAIChatCompletionResponse);
      if (content) {
        yield content;
        return;
      }
    } catch {
      // Fall through to a clear compatibility error below.
    }
    const safeBody = redactRuntimeAISecrets(rawBody, runtimeConfig.apiKey);
    throw new Error(`OpenAI-compatible API returned non-stream response without usable content${safeBody ? `: ${safeBody}` : ''}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const payload = trimmed.slice(6);
      if (payload === '[DONE]') return;
      try {
        const parsed = JSON.parse(payload) as OpenAIStreamChunk;
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch {
        // Some compatible gateways send keepalive lines. Ignore malformed chunks.
      }
    }
  }
}

export async function llmInvoke(
  messages: Message[],
  options?: RuntimeLLMOptions,
  customHeaders?: Record<string, string>,
  runtimeConfig?: Partial<RuntimeAIConfig>,
): Promise<string> {
  void customHeaders;
  const resolvedRuntimeConfig = await resolveRuntimeTextConfig(runtimeConfig, options);
  if (!hasRuntimeAIProvider(resolvedRuntimeConfig)) {
    throw new Error('账号绑定的模型服务尚未配置，已停止使用历史平台 fallback。');
  }

  const attempts = Math.max(1, Number(process.env.REAL_SERVICE_LLM_RETRIES || 2));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      let fullContent = '';
      for await (const chunk of openAICompatStream(messages, options, resolvedRuntimeConfig)) {
        fullContent += chunk;
      }
      return fullContent;
    } catch (error) {
      lastError = error;
      if (options?.signal?.aborted || attempt >= attempts || !shouldRetryTransientError(error)) throw error;
      await waitForTransientRetry(attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'LLM invocation failed'));
}

export async function* llmStream(
  messages: Message[],
  options?: RuntimeLLMOptions,
  customHeaders?: Record<string, string>,
  runtimeConfig?: Partial<RuntimeAIConfig>,
): AsyncGenerator<string, void, unknown> {
  void customHeaders;
  const resolvedRuntimeConfig = await resolveRuntimeTextConfig(runtimeConfig, options);
  if (!hasRuntimeAIProvider(resolvedRuntimeConfig)) {
    throw new Error('账号绑定的模型服务尚未配置，已停止使用历史平台 fallback。');
  }
  yield* openAICompatStream(messages, options, resolvedRuntimeConfig);
}

// --- TTS Service ---
export async function ttsSynthesize(
  text: string,
  options?: { speaker?: string; audioFormat?: 'mp3' | 'pcm' | 'ogg_opus'; speechRate?: number },
): Promise<{ audioUri: string; audioSize: number }> {
  void options?.speechRate;
  const response = await synthesizeDoubaoAgentPlanTts(text, {
    speaker: options?.speaker,
    uid: `user-${Date.now()}`,
    filePrefix: 'tts',
  });
  return { audioUri: response.audioUrl, audioSize: response.audioSize };
}

// --- Image Generation Service ---
export async function generateImage(
  prompt: string,
  options?: { size?: string; model?: string },
): Promise<{ urls: string[] }> {
  void prompt;
  void options;
  throw new Error('图片生成已停止使用历史平台 SDK fallback；请改用 /api/ai/ppt 图像 PPT 的 Ark/AgentPlan 视觉生成链路。');
}

// --- Podcast service ---
const DOUBAO_AGENTPLAN_TTS_ENDPOINT = process.env.AGENTPLAN_TTS_ENDPOINT?.trim()
  || process.env.DOUBAO_TTS_ENDPOINT?.trim()
  || process.env.DOUBAO_AGENTPLAN_TTS_ENDPOINT?.trim()
  || 'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional';
const DOUBAO_AGENTPLAN_TTS_RESOURCE_ID = process.env.AGENTPLAN_TTS_RESOURCE_ID?.trim()
  || process.env.DOUBAO_TTS_RESOURCE_ID?.trim()
  || process.env.DOUBAO_AGENTPLAN_TTS_RESOURCE_ID?.trim()
  || 'seed-tts-2.0';
const DOUBAO_AGENTPLAN_TTS_API_KEY = process.env.AGENTPLAN_TTS_API_KEY?.trim()
  || process.env.DOUBAO_TTS_API_KEY?.trim()
  || process.env.DOUBAO_AGENTPLAN_TTS_API_KEY?.trim()
  || process.env.ARK_AGENTPLAN_API_KEY?.trim()
  || process.env.ARK_API_KEY?.trim()
  || '';
const DOUBAO_AGENTPLAN_TTS_SPEAKER = process.env.AGENTPLAN_TTS_SPEAKER?.trim()
  || process.env.DOUBAO_TTS_SPEAKER?.trim()
  || process.env.DOUBAO_AGENTPLAN_TTS_SPEAKER?.trim()
  || process.env.ARK_TTS_SPEAKER?.trim()
  || '';

type PodcastGenerationOptions = {
  apiKey?: string;
  ttsSpeaker?: string;
  runtimeConfig?: Partial<RuntimeAIConfig>;
};

export type PodcastAudioSegment = {
  index: number;
  text: string;
  status: 'succeeded' | 'failed';
  audioUrl?: string;
  provider?: PodcastProvider;
  error?: string;
};

export type PodcastGenerationStatus = {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  audioUrl?: string;
  message?: string;
  error?: string;
  retryAfterSeconds?: number;
  provider: 'status-url-template' | 'not_configured';
};

function redactPodcastSecret(text: string, requestApiKey?: string): string {
  let safeText = redactVolcenginePodcastSecret(text);
  if (DOUBAO_AGENTPLAN_TTS_API_KEY) safeText = safeText.split(DOUBAO_AGENTPLAN_TTS_API_KEY).join('[REDACTED]');
  if (requestApiKey?.trim()) safeText = safeText.split(requestApiKey.trim()).join('[REDACTED]');
  return safeText
    .replace(/("?(?:api[_-]?key|authorization|x-api-key)"?\s*[:=]\s*"?)[^"\s,;}]+/gi, '$1[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
}

export function classifyPodcastGenerationError(error: unknown): PodcastGenerationFailure {
  const rawMessage = error instanceof Error ? error.message : String(error || '播客生成失败');
  const message = redactPodcastSecret(rawMessage);
  const statusMatch = message.match(/(?:豆包语音合成 API error|Unexpected server response):\s*(\d{3})/i)
    || message.match(/\bHTTP\s+(\d{3})\b/i);
  const upstreamStatus = statusMatch ? Number(statusMatch[1]) : undefined;
  const requestId = message.match(/"reqid"\s*:\s*"([^"]+)"/i)?.[1]
    || message.match(/\breqid[=:]\s*([A-Za-z0-9-]+)/i)?.[1];
  const lower = message.toLowerCase();

  if (/abort|timeout|timed out|signal timed out/i.test(message)) {
    return {
      errorType: 'timeout',
      error: message,
      userMessage: '豆包语音合成超时，可以稍后重试或缩短播客文本。',
      retryable: true,
      requestId,
      upstreamStatus,
    };
  }

  if (upstreamStatus === 401 || /invalid x-api-key|invalid api key|access.?key|grant not found|unauthori[sz]ed|认证|鉴权/i.test(message)) {
    return {
      errorType: 'auth',
      error: message,
      userMessage: '播客服务鉴权失败：当前账号绑定的语音服务不可用或未开通，请稍后重试。',
      retryable: false,
      requestId,
      upstreamStatus,
    };
  }

  if (upstreamStatus === 403 || /forbidden|permission|not allowed|无权限/i.test(message)) {
    return {
      errorType: 'permission',
      error: message,
      userMessage: '播客服务访问被拒绝：当前账号可能没有该 APP、Resource-Id、音色或接口权限。',
      retryable: false,
      requestId,
      upstreamStatus,
    };
  }

  if (upstreamStatus === 429 || /rate.?limit|too many|quota|限流|额度/i.test(message)) {
    return {
      errorType: 'rate_limit',
      error: message,
      userMessage: '播客服务暂时限流或额度不足，请稍后重试或检查账号配额。',
      retryable: true,
      requestId,
      upstreamStatus,
    };
  }

  if (/missing|not configured|缺少/i.test(message)) {
    return {
      errorType: 'configuration',
      error: message,
      userMessage: '播客音频服务配置不完整，请联系服务方检查语音合成配置。',
      retryable: false,
      requestId,
      upstreamStatus,
    };
  }

  if (/55000000|resource.?id.*mismatch|resource id is mismatched with speaker|音色.*Resource-Id|Resource-Id.*音色/i.test(message)) {
    return {
      errorType: 'invalid_request',
      error: message,
      userMessage: '播客音色与豆包语音合成 Resource-Id 不匹配：请在 Agent Plan 控制台选择同一语音模型下的音色，或同步替换 AGENTPLAN_TTS_RESOURCE_ID 和 AGENTPLAN_TTS_SPEAKER。',
      retryable: false,
      requestId,
      upstreamStatus,
    };
  }

  if (upstreamStatus === 400 || upstreamStatus === 404 || /speaker|resource|invalid request|bad request|参数/i.test(lower)) {
    return {
      errorType: 'invalid_request',
      error: message,
      userMessage: '播客请求参数不被接受，请检查豆包语音合成 Resource-Id、音色、音频格式和模型版本。',
      retryable: false,
      requestId,
      upstreamStatus,
    };
  }

  return {
    errorType: upstreamStatus ? 'upstream' : 'unknown',
    error: message,
    userMessage: '播客音频生成失败，请稍后重试；如果持续失败，请检查豆包语音合成配置和上游服务状态。',
    retryable: true,
    requestId,
    upstreamStatus,
  };
}

function readNestedString(payload: unknown, paths: string[][]): string | undefined {
  for (const pathParts of paths) {
    let value: unknown = payload;
    for (const part of pathParts) {
      if (!value || typeof value !== 'object' || !(part in value)) {
        value = undefined;
        break;
      }
      value = (value as Record<string, unknown>)[part];
    }
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function resolveDoubaoAgentPlanSpeaker(options?: PodcastGenerationOptions): string {
  return options?.ttsSpeaker?.trim() || DOUBAO_AGENTPLAN_TTS_SPEAKER;
}

function resolveDoubaoAgentPlanApiKey(options?: PodcastGenerationOptions): string {
  return DOUBAO_AGENTPLAN_TTS_API_KEY || options?.apiKey?.trim() || '';
}

function isDoubaoAgentPlanTtsConfigured(options?: PodcastGenerationOptions): boolean {
  return Boolean(DOUBAO_AGENTPLAN_TTS_ENDPOINT && resolveDoubaoAgentPlanApiKey(options) && DOUBAO_AGENTPLAN_TTS_RESOURCE_ID && resolveDoubaoAgentPlanSpeaker(options));
}

function resolvePodcastAudioProviderPreference(): PodcastAudioProviderPreference {
  const value = process.env.PODCAST_AUDIO_PROVIDER?.trim().toLowerCase();
  if (value === 'volcengine' || value === 'volcengine-podcast' || value === 'volcengine-podcast-ws-v3') {
    return 'volcengine-podcast';
  }
  if (value === 'doubao' || value === 'doubao-tts' || value === 'agentplan-tts') {
    return 'doubao-tts';
  }
  return 'auto';
}

function normalizePodcastScript(text: string): string {
  return text
    .replace(/```(?:json|markdown|md)?/gi, '')
    .replace(/```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanPodcastTextForTts(text: string): string {
  return normalizePodcastScript(text)
    .replace(/(^|\n)\s*(主持人|主播|研究员|嘉宾|专家|讲述者|Host|Guest|Speaker\s*\d*)\s*[：:]\s*/gi, '$1')
    .replace(/\[(?:\d+|[一二三四五六七八九十]+)(?:[\s,，、-]+(?:\d+|[一二三四五六七八九十]+))*\]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function boundedPodcastTtsChars(envNames: string | string[], fallback: number, min = 220, max = 1400): number {
  const names = Array.isArray(envNames) ? envNames : [envNames];
  const raw = names.map(name => process.env[name]?.trim()).find(Boolean);
  const configured = Number(raw || fallback);
  if (!Number.isFinite(configured)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(configured)));
}

function compactTextForPodcastTts(text: string, maxChars = boundedPodcastTtsChars(['AGENTPLAN_TTS_MAX_TEXT_CHARS', 'DOUBAO_TTS_MAX_TEXT_CHARS'], 280, 120, 280)): string {
  const cleaned = cleanPodcastTextForTts(text);
  if (cleaned.length <= maxChars) return cleaned;

  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(Boolean);
  let output = '';
  for (const paragraph of paragraphs) {
    const next = output ? `${output}\n\n${paragraph}` : paragraph;
    if (next.length > maxChars) break;
    output = next;
  }
  if (output.length >= 400) return output;
  return `${cleaned.slice(0, maxChars - 1).trim()}…`;
}

async function buildPodcastDialogueText(text: string, options?: PodcastGenerationOptions): Promise<string> {
  if (!hasRuntimeAIProvider(options?.runtimeConfig)) {
    return normalizePodcastScript(text);
  }

  const prompt = [
    '你是灵笔的播客脚本编辑。请把检索证据改写成一段可直接交给 TTS 的中文双人播客口播稿。',
    '要求：',
    '1. 只输出口播稿正文，不要 JSON，不要 Markdown 代码块。',
    '2. 两位主播交替发言，用“主持人：”“研究员：”标记。',
    '3. 保留 [1]、[2] 这类引用编号，不能编造没有出现的来源。',
    '4. 控制在 900-1400 个中文字符，避免把原始资料全文送给 TTS。',
    '5. 语气清晰自然，覆盖问题、方法、关键发现、局限和下一步。',
    '',
    '【检索证据与生成要求】',
    text,
  ].join('\n');

  const script = await llmInvoke(
    [{ role: 'user', content: prompt }],
    {
      temperature: 0.35,
      maxTokens: Number(process.env.PODCAST_SCRIPT_MAX_TOKENS || 900),
    },
    undefined,
    options.runtimeConfig,
  );

  return normalizePodcastScript(script);
}

async function buildPodcastSpeechText(text: string, options?: PodcastGenerationOptions): Promise<string> {
  return compactTextForPodcastTts(cleanPodcastTextForTts(await buildPodcastDialogueText(text, options)));
}

function splitPodcastTtsSegments(text: string): string[] {
  const cleaned = cleanPodcastTextForTts(text).replace(/\s+/g, ' ');
  const maxSegments = Math.max(1, Math.min(10, Number(process.env.AGENTPLAN_TTS_MAX_SEGMENTS || process.env.DOUBAO_TTS_MAX_SEGMENTS || 6)));
  const maxChars = boundedPodcastTtsChars(['AGENTPLAN_TTS_SEGMENT_CHARS', 'DOUBAO_TTS_SEGMENT_CHARS'], 180, 80, 300);
  const sentences = cleaned
    .split(/(?<=[。！？!?；;])\s*/)
    .map(part => part.trim())
    .filter(Boolean);

  const segments: string[] = [];
  let current = '';
  const pushCurrent = () => {
    const value = current.trim();
    if (value) segments.push(value);
    current = '';
  };

  for (const sentence of sentences.length > 0 ? sentences : [cleaned]) {
    if (segments.length >= maxSegments) break;
    if (sentence.length > maxChars) {
      pushCurrent();
      for (let index = 0; index < sentence.length && segments.length < maxSegments; index += maxChars) {
        const part = sentence.slice(index, index + maxChars).trim();
        if (part) segments.push(part);
      }
      continue;
    }
    const next = current ? `${current}${sentence}` : sentence;
    if (next.length > maxChars) {
      pushCurrent();
      current = sentence;
    } else {
      current = next;
    }
  }
  if (segments.length < maxSegments) pushCurrent();
  return segments.slice(0, maxSegments).map(segment => compactTextForPodcastTts(segment, maxChars));
}

async function readPodcastAudioSegment(audioUrl: string): Promise<Buffer> {
  if (audioUrl.startsWith('/uploads/')) {
    const { readFile } = await import('fs/promises');
    const path = await import('path');
    return readFile(path.join(process.cwd(), 'public', audioUrl));
  }
  if (/^https?:\/\//i.test(audioUrl)) {
    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error(`读取播客音频片段失败：HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error(`不支持的播客音频片段地址：${audioUrl.slice(0, 80)}`);
}

async function mergePodcastAudioSegments(segments: PodcastAudioSegment[]): Promise<string | undefined> {
  const urls = segments
    .filter(segment => segment.status === 'succeeded' && segment.audioUrl)
    .sort((a, b) => a.index - b.index)
    .map(segment => segment.audioUrl as string);
  if (urls.length === 0) return undefined;
  if (urls.length === 1) return urls[0];

  const buffers = await Promise.all(urls.map(readPodcastAudioSegment));
  const merged = Buffer.concat(buffers);
  const stored = await storeFile(merged, `podcast-complete-${Date.now()}.mp3`, 'audio/mpeg');
  return resolveFileUrl(stored.key);
}

async function generateDoubaoAgentPlanPodcast(text: string, options?: PodcastGenerationOptions): Promise<{ audioUrl?: string; provider: PodcastProvider }> {
  const speaker = resolveDoubaoAgentPlanSpeaker(options);
  const apiKey = resolveDoubaoAgentPlanApiKey(options);
  const result = await synthesizeDoubaoAgentPlanTts(text, {
    apiKey,
    speaker,
    filePrefix: 'podcast',
    maxChars: boundedPodcastTtsChars(['AGENTPLAN_TTS_ROUTE_MAX_CHARS', 'DOUBAO_TTS_ROUTE_MAX_CHARS'], 1000, 120, 2000),
  });
  return { audioUrl: result.audioUri, provider: result.provider };
}

function normalizePodcastStatus(taskId: string, payload: unknown): PodcastGenerationStatus {
  const rawStatus = readNestedString(payload, [
    ['status'],
    ['state'],
    ['data', 'status'],
    ['data', 'state'],
    ['data', 'content', 'status'],
    ['data', 'content', 'state'],
  ])?.toLowerCase();
  const audioUrl = readNestedString(payload, [
    ['audioUrl'],
    ['audio_url'],
    ['podcast_url'],
    ['data', 'audioUrl'],
    ['data', 'audio_url'],
    ['data', 'podcast_url'],
    ['data', 'content', 'audioUrl'],
    ['data', 'content', 'audio_url'],
    ['data', 'content', 'podcast_url'],
  ]);
  const message = readNestedString(payload, [
    ['message'],
    ['msg'],
    ['data', 'message'],
    ['data', 'msg'],
    ['data', 'content', 'message'],
  ]);
  const error = readNestedString(payload, [
    ['error'],
    ['error_message'],
    ['data', 'error'],
    ['data', 'error_message'],
    ['data', 'content', 'error'],
  ]);

  if (audioUrl) {
    return { taskId, status: 'completed', audioUrl, message: message || '播客音频已生成。', provider: 'status-url-template' };
  }
  if (rawStatus && /(fail|failed|error|cancel|canceled|cancelled)/i.test(rawStatus)) {
    return { taskId, status: 'failed', error: error || message || '播客生成失败，请重试。', provider: 'status-url-template' };
  }
  if (rawStatus && /(complete|completed|success|succeeded|done)/i.test(rawStatus)) {
    return { taskId, status: 'completed', message: message || '播客任务已完成，但上游未返回音频地址。', provider: 'status-url-template' };
  }
  return {
    taskId,
    status: rawStatus?.includes('pending') ? 'pending' : 'running',
    message: message || '播客任务正在生成中，请稍后刷新状态。',
    retryAfterSeconds: 5,
    provider: 'status-url-template',
  };
}

export async function generatePodcast(text: string, options?: PodcastGenerationOptions): Promise<{ audioUrl?: string; dialogueText?: string; taskId?: string; provider?: PodcastProvider }> {
  const preferredProvider = resolvePodcastAudioProviderPreference();
  if (preferredProvider !== 'volcengine-podcast' && isDoubaoAgentPlanTtsConfigured(options)) {
    const dialogueText = await buildPodcastSpeechText(text, options);
    try {
      return {
        ...(await generateDoubaoAgentPlanPodcast(dialogueText, options)),
        dialogueText,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryMaxChars = boundedPodcastTtsChars(['AGENTPLAN_TTS_RETRY_MAX_TEXT_CHARS', 'DOUBAO_TTS_RETRY_MAX_TEXT_CHARS'], 160, 80, 220);
      if (!/429|quota|rate.?limit|限流|额度/i.test(message) || dialogueText.length <= retryMaxChars) {
        throw new PodcastAudioGenerationError(message, dialogueText, { cause: error });
      }
      const retryText = compactTextForPodcastTts(dialogueText, retryMaxChars);
      try {
        return {
          ...(await generateDoubaoAgentPlanPodcast(retryText, options)),
          dialogueText: retryText,
        };
      } catch (retryError) {
        const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
        throw new PodcastAudioGenerationError(retryMessage, retryText, { cause: retryError });
      }
    }
  }

  if (preferredProvider !== 'doubao-tts' && isVolcenginePodcastConfigured()) {
    const dialogueText = await buildPodcastSpeechText(text, options);
    try {
      const result = await generateVolcenginePodcast(dialogueText);
      if (result.audioUrl) {
        return {
          audioUrl: result.audioUrl,
          dialogueText,
          taskId: result.taskId,
          provider: 'volcengine-podcast-ws-v3',
        };
      }
      if (result.audioBuffer) {
        const stored = await storeFile(
          result.audioBuffer,
          `podcast-${Date.now()}.${result.format || 'mp3'}`,
          `audio/${result.format || 'mpeg'}`,
        );
        return {
          audioUrl: await resolveFileUrl(stored.key),
          dialogueText,
          taskId: result.taskId,
          provider: 'volcengine-podcast-ws-v3',
        };
      }
      throw new Error('VolcEngine Podcast returned no audio URL or audio data.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new PodcastAudioGenerationError(message, dialogueText, { cause: error });
    }
  }

  if (preferredProvider === 'doubao-tts') {
    throw new PodcastAudioGenerationError(
      '豆包语音合成未配置：缺少 endpoint、Resource-Id、服务密钥或 speaker。',
      compactTextForPodcastTts(text),
    );
  }
  if (preferredProvider === 'volcengine-podcast') {
    throw new PodcastAudioGenerationError(
      'VolcEngine Podcast is not configured: missing VOLCENGINE_PODCAST_APP_ID, VOLCENGINE_PODCAST_ACCESS_KEY, or VOLCENGINE_PODCAST_RESOURCE_ID.',
      compactTextForPodcastTts(text),
    );
  }

  throw new PodcastAudioGenerationError(
    '播客音频 provider 未配置：请配置 AGENTPLAN_TTS_* 豆包语音合成，或显式配置 VOLCENGINE_PODCAST_*。',
    compactTextForPodcastTts(text),
  );
}

export async function generatePodcastSegments(text: string, options?: PodcastGenerationOptions): Promise<{
  audioUrl?: string;
  dialogueText: string;
  segments: PodcastAudioSegment[];
  provider?: PodcastProvider;
  partial: boolean;
}> {
  const preferredProvider = resolvePodcastAudioProviderPreference();
  if (preferredProvider === 'volcengine-podcast') {
    const single = await generatePodcast(text, options);
    return {
      audioUrl: single.audioUrl,
      dialogueText: single.dialogueText || '',
      segments: single.audioUrl ? [{
        index: 0,
        text: single.dialogueText || '',
        status: 'succeeded',
        audioUrl: single.audioUrl,
        provider: single.provider,
      }] : [],
      provider: single.provider,
      partial: false,
    };
  }

  if (!isDoubaoAgentPlanTtsConfigured(options)) {
    const single = await generatePodcast(text, options);
    return {
      audioUrl: single.audioUrl,
      dialogueText: single.dialogueText || '',
      segments: single.audioUrl ? [{
        index: 0,
        text: single.dialogueText || '',
        status: 'succeeded',
        audioUrl: single.audioUrl,
        provider: single.provider,
      }] : [],
      provider: single.provider,
      partial: false,
    };
  }

  const dialogueText = await buildPodcastDialogueText(text, options);
  const ttsSegments = splitPodcastTtsSegments(dialogueText);
  const segments: PodcastAudioSegment[] = [];

  for (const [index, segmentText] of ttsSegments.entries()) {
    try {
      const result = await generateDoubaoAgentPlanPodcast(segmentText, options);
      segments.push({
        index,
        text: segmentText,
        status: 'succeeded',
        audioUrl: result.audioUrl,
        provider: result.provider,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      segments.push({
        index,
        text: segmentText,
        status: 'failed',
        error: redactPodcastSecret(message, options?.apiKey),
      });
      if (segments.some(segment => segment.status === 'succeeded')) break;
      const retryMaxChars = boundedPodcastTtsChars(['AGENTPLAN_TTS_RETRY_MAX_TEXT_CHARS', 'DOUBAO_TTS_RETRY_MAX_TEXT_CHARS'], 30, 16, 42);
      if (/429|quota|rate.?limit|限流|额度/i.test(message) && segmentText.length > retryMaxChars) {
        const retryText = compactTextForPodcastTts(segmentText, retryMaxChars);
        try {
          const result = await generateDoubaoAgentPlanPodcast(retryText, options);
          segments.push({
            index,
            text: retryText,
            status: 'succeeded',
            audioUrl: result.audioUrl,
            provider: result.provider,
          });
          break;
        } catch (retryError) {
          const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
          segments.push({
            index,
            text: retryText,
            status: 'failed',
            error: redactPodcastSecret(retryMessage, options?.apiKey),
          });
        }
      }
      if (!segments.some(segment => segment.status === 'succeeded')) {
        throw new PodcastAudioGenerationError(message, dialogueText, { cause: error, segments });
      }
      break;
    }
  }

  const succeeded = segments.filter(segment => segment.status === 'succeeded' && segment.audioUrl);
  if (succeeded.length === 0) {
    throw new PodcastAudioGenerationError('豆包语音合成未生成可播放音频片段。', dialogueText, { segments });
  }
  let mergedAudioUrl: string | undefined;
  try {
    mergedAudioUrl = await mergePodcastAudioSegments(segments);
  } catch {
    mergedAudioUrl = undefined;
  }

  return {
    audioUrl: mergedAudioUrl || succeeded[0].audioUrl,
    dialogueText,
    segments,
    provider: succeeded[0].provider,
    partial: succeeded.length < ttsSegments.length || segments.some(segment => segment.status === 'failed'),
  };
}

export async function getPodcastStatus(taskId: string): Promise<PodcastGenerationStatus> {
  const trimmedTaskId = taskId.trim();
  if (!trimmedTaskId) throw new Error('缺少 taskId');

  const statusUrlTemplate = process.env.PODCAST_STATUS_URL_TEMPLATE?.trim();
  if (!statusUrlTemplate) {
    return {
      taskId: trimmedTaskId,
      status: 'running',
      message: '播客任务已提交。当前部署尚未配置上游状态查询接口，系统会继续轮询并在超时后提示重试。',
      retryAfterSeconds: 5,
      provider: 'not_configured',
    };
  }

  const statusUrl = statusUrlTemplate.replace(/\{taskId\}/g, encodeURIComponent(trimmedTaskId));
  const res = await fetch(statusUrl, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  const rawBody = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`Podcast status API error: ${res.status}${rawBody ? ` - ${redactPodcastSecret(rawBody)}` : ''}`);
  }

  try {
    return normalizePodcastStatus(trimmedTaskId, JSON.parse(rawBody));
  } catch {
    throw new Error(`Podcast status API returned invalid JSON${rawBody ? ` - ${redactPodcastSecret(rawBody.slice(0, 200))}` : ''}`);
  }
}

// --- Utility: Build system prompts ---
export const SYSTEM_PROMPTS = {
  academicQA: `你是一位严谨的学术研究助手。基于用户提供的文献内容，回答学术问题、进行对比分析、论点溯源。
规则：
1. 回答应简明扼要，直击要点，避免冗长铺垫和重复，用最少的文字传达完整信息
2. 优先基于提供的文献内容回答，核心观点标注来源，格式：内容[1]
3. 如果文献中有相关内容，请充分引用并分析，不要轻易拒绝回答
4. 仅当文献内容完全空白或与问题毫无关联时，才回复"当前上传的资料中没有相关内容，无法为你解答"
5. 你可以基于文献内容进行合理的推理和延伸分析，但必须明确标注哪些是文献原文、哪些是你的分析
6. 引用格式：[第一作者. 发表年份]`,

  reportGeneration: `你是一位学术论文综述撰写专家。根据提供的多篇论文，生成结构化的跨文献总结报告。
报告必须包含以下结构：
1. 研究背景与目的
2. 核心论点对比分析
3. 实验方法汇总
4. 研究成果总结
5. 研究局限与展望

规则：
1. 所有结论必须严格基于提供的文献内容，不得编造
2. 每个核心观点必须标注上角标数字脚注，格式：内容[1]
3. 文末生成参考文献列表，每条参考文献必须单独一行，使用有序列表格式：
   \`\`\`
   ## 参考文献
   1. 作者1 等. 标题1. 期刊, 年份.
   2. 作者2 等. 标题2. 期刊, 年份.
   3. ...
   \`\`\`
   禁止将多条参考文献写在同一行
4. 使用 Markdown 格式输出`,

  bilingualSubtitle: `你是一位学术宣讲双语字幕专家。根据提供的PPT页面内容，生成中英双语字幕文本。

必须生成两个独立版本：

【字幕文本（书面版）】：
- 严谨书面语
- 完整保留专业术语、希腊字母、公式编号、引用标注
- 与PPT内容完全对应
- 用于页面下方固定展示

【音频文本（口语版）】：
- 适配语音播报场景
- 自动将希腊字母转化为标准口语读法（如α→"阿尔法"，β→"贝塔"）
- 专业术语用标准读法（如HR→"风险比"，HDL-C→"H D L cholesterol"）
- 增加口语化过渡词，适配宣讲语气

规则：所有内容必须严格基于提供的文献内容。`,

  pptGeneration: `你是一位学术宣讲PPT生成专家。根据提供的富文本报告，生成宣讲用PPT的内容大纲。

每页PPT格式：
---
## 第N页：[标题]
- 核心论点：（一句话概括）
- 关键数据：（引用原文数据+脚注）
- 对应图片：（描述需要的图片类型）
- 引用来源：[作者. 年份]
---

规则：
1. 一页PPT=一个核心论点+精简文本
2. 所有数据必须标注来源
3. 内容必须严格基于提供的文献
4. 生成5-8页为宜`,
};
