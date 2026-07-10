export type ExplainerVideoModelFamily = 'seedance-1.5' | 'seedance-2' | 'unknown';
export type ExplainerVideoRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
export type ExplainerVideoResolution = '480p' | '720p' | '1080p';

type EnvLike = Record<string, string | undefined>;

export interface ExplainerVideoProviderPublicStatus {
  provider: 'ark-seedance';
  configured: boolean;
  modelFamily: ExplainerVideoModelFamily;
  missing: Array<'apiBase' | 'apiKey' | 'model'>;
}

export interface ExplainerVideoProviderConfig {
  provider: 'ark-seedance';
  apiBase: string;
  apiKey: string;
  model: string;
  modelFamily: ExplainerVideoModelFamily;
  configured: boolean;
  publicStatus: ExplainerVideoProviderPublicStatus;
}

export interface ExplainerVideoClipRequest {
  prompt: string;
  ratio: ExplainerVideoRatio;
  resolution: ExplainerVideoResolution;
  durationSeconds: number;
  generateAudio: boolean;
}

export interface ExplainerVideoTask {
  id: string;
  status: 'queued';
}

export interface ExplainerVideoTaskResult {
  id: string;
  status: 'pending' | 'succeeded';
  videoUrl?: string;
  lastFrameUrl?: string;
}

interface ProviderDependencies {
  fetchImpl?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
}

function firstEnv(env: EnvLike, ...names: string[]): string {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return '';
}

function modelFamily(model: string): ExplainerVideoModelFamily {
  const normalized = model.toLowerCase();
  if (/seedance[-_.]?2(?:[-_.]?0)?/.test(normalized)) return 'seedance-2';
  if (/seedance[-_.]?1[-_.]?5/.test(normalized)) return 'seedance-1.5';
  return 'unknown';
}

export function resolveExplainerVideoProviderConfig(env: EnvLike = process.env): ExplainerVideoProviderConfig {
  const apiBase = firstEnv(env, 'EXPLAINER_VIDEO_API_BASE', 'ARK_AGENTPLAN_API_BASE');
  const apiKey = firstEnv(env, 'EXPLAINER_VIDEO_API_KEY', 'ARK_AGENTPLAN_API_KEY');
  const model = firstEnv(env, 'EXPLAINER_VIDEO_MODEL', 'ARK_AGENTPLAN_VIDEO_MODEL');
  const missing: ExplainerVideoProviderPublicStatus['missing'] = [];
  if (!apiBase) missing.push('apiBase');
  if (!apiKey) missing.push('apiKey');
  if (!model) missing.push('model');
  const family = modelFamily(model);
  const configured = missing.length === 0;
  return {
    provider: 'ark-seedance',
    apiBase,
    apiKey,
    model,
    modelFamily: family,
    configured,
    publicStatus: {
      provider: 'ark-seedance',
      configured,
      modelFamily: family,
      missing,
    },
  };
}

function taskBaseUrl(apiBase: string): string {
  const base = apiBase.replace(/\/+$/, '');
  if (/\/contents\/generations\/tasks$/.test(base)) return base;
  if (/\/api\/plan\/v3$/.test(base) || /\/v3$/.test(base)) {
    return `${base}/contents/generations/tasks`;
  }
  return `${base}/api/v3/contents/generations/tasks`;
}

function nearest(value: number, supported: number[]): number {
  return supported.reduce((best, candidate) => (
    Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best
  ));
}

function durationForModel(value: number, family: ExplainerVideoModelFamily): number {
  const requested = Number.isFinite(value) ? Math.max(1, Math.round(value)) : 5;
  if (family === 'seedance-1.5') {
    const supported = [5, 10, 20, 40];
    return supported.find(duration => duration >= requested) || supported[supported.length - 1];
  }
  if (family === 'seedance-2') return Math.max(2, Math.min(15, requested));
  return nearest(requested, [5, 10]);
}

async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => null);
  return payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
}

function errorMessage(payload: Record<string, unknown>, fallback: string): string {
  const nested = payload.error;
  if (nested && typeof nested === 'object' && typeof (nested as { message?: unknown }).message === 'string') {
    return (nested as { message: string }).message;
  }
  if (typeof payload.msg === 'string') return payload.msg;
  if (typeof payload.message === 'string') return payload.message;
  return fallback;
}

function taskPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return payload.data && typeof payload.data === 'object'
    ? payload.data as Record<string, unknown>
    : payload;
}

function taskId(payload: Record<string, unknown>): string {
  const data = taskPayload(payload);
  return typeof data.id === 'string' ? data.id : typeof payload.id === 'string' ? payload.id : '';
}

export function createArkExplainerVideoProvider(
  config: ExplainerVideoProviderConfig,
  dependencies: ProviderDependencies = {},
) {
  if (!config.configured) throw new Error('讲解视频 provider 未配置完整。');
  const fetchImpl = dependencies.fetchImpl || fetch;
  const wait = dependencies.wait || ((milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const baseUrl = taskBaseUrl(config.apiBase);
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };

  return {
    async submit(input: ExplainerVideoClipRequest, options: { signal?: AbortSignal } = {}): Promise<ExplainerVideoTask> {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const prompt = input.prompt.trim();
      if (prompt.length < 8) throw new Error('讲解视频镜头描述至少需要 8 个字。');
      const response = await fetchImpl(baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          content: [{ type: 'text', text: prompt }],
          ratio: input.ratio,
          resolution: input.resolution,
          duration: durationForModel(input.durationSeconds, config.modelFamily),
          generate_audio: input.generateAudio,
          watermark: false,
        }),
        signal: options.signal,
      });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(`Seedance 任务提交失败：${errorMessage(payload, `HTTP ${response.status}`)}`);
      const id = taskId(payload);
      if (!id) throw new Error('Seedance 任务提交成功但未返回任务 ID。');
      return { id, status: 'queued' };
    },

    async getStatus(id: string, options: { signal?: AbortSignal } = {}): Promise<ExplainerVideoTaskResult> {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const response = await fetchImpl(`${baseUrl}/${encodeURIComponent(id)}`, {
        method: 'GET',
        headers,
        signal: options.signal,
      });
      const raw = await responsePayload(response);
      if (!response.ok) throw new Error(`Seedance 任务查询失败：${errorMessage(raw, `HTTP ${response.status}`)}`);
      const payload = taskPayload(raw);
      const status = typeof payload.status === 'string' ? payload.status : '';
      if (status === 'failed' || status === 'cancelled' || status === 'expired') {
        throw new Error(`Seedance 任务${status === 'expired' ? '超时' : '失败'}：${errorMessage(payload, status)}`);
      }
      if (status !== 'succeeded') return { id, status: 'pending' };

      const content = payload.content && typeof payload.content === 'object'
        ? payload.content as Record<string, unknown>
        : {};
      const videoUrl = typeof content.video_url === 'string' ? content.video_url : '';
      if (!videoUrl) throw new Error('Seedance 任务成功但未返回视频 URL。');
      return {
        id,
        status: 'succeeded',
        videoUrl,
        lastFrameUrl: typeof content.last_frame_url === 'string' ? content.last_frame_url : undefined,
      };
    },

    async waitForResult(
      id: string,
      options: { signal?: AbortSignal; maxAttempts?: number; intervalMs?: number } = {},
    ): Promise<ExplainerVideoTaskResult> {
      const maxAttempts = Math.max(1, Math.floor(options.maxAttempts || 120));
      const intervalMs = Math.max(0, Math.floor(options.intervalMs ?? 5_000));
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const result = await this.getStatus(id, { signal: options.signal });
        if (result.status === 'succeeded') return result;
        if (attempt < maxAttempts - 1) await wait(intervalMs);
      }
      throw new Error(`Seedance 视频任务超时：${id} 在 ${maxAttempts} 次查询后仍未完成。`);
    },
  };
}
