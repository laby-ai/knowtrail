import { resolveFileUrl, storeFile } from './storage';

export type DoubaoAgentPlanTtsResult = {
  audioUri: string;
  audioUrl: string;
  audioSize: number;
  provider: 'doubao-tts-v3';
  contentType: string;
  textLength: number;
};

export type DoubaoAgentPlanTtsOptions = {
  apiKey?: string;
  speaker?: string;
  uid?: string;
  filePrefix?: string;
  maxChars?: number;
};

function readEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return '';
}

function resolveEndpoint() {
  return readEnv('AGENTPLAN_TTS_ENDPOINT', 'DOUBAO_TTS_ENDPOINT')
    || 'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional';
}

function resolveResourceId() {
  return readEnv('AGENTPLAN_TTS_RESOURCE_ID', 'DOUBAO_TTS_RESOURCE_ID') || 'seed-tts-2.0';
}

function resolveApiKey(options?: DoubaoAgentPlanTtsOptions) {
  return options?.apiKey?.trim() || readEnv('AGENTPLAN_TTS_API_KEY', 'DOUBAO_TTS_API_KEY', 'ARK_AGENTPLAN_API_KEY');
}

function resolveSpeaker(options?: DoubaoAgentPlanTtsOptions) {
  return options?.speaker?.trim() || readEnv('AGENTPLAN_TTS_SPEAKER', 'DOUBAO_TTS_SPEAKER', 'ARK_TTS_SPEAKER');
}

function audioFormat() {
  return readEnv('AGENTPLAN_TTS_FORMAT', 'DOUBAO_TTS_FORMAT') || 'mp3';
}

function sampleRate() {
  const value = Number(readEnv('AGENTPLAN_TTS_SAMPLE_RATE', 'DOUBAO_TTS_SAMPLE_RATE') || 24000);
  return Number.isFinite(value) ? value : 24000;
}

function timeoutMs() {
  const value = Number(readEnv('AGENTPLAN_TTS_TIMEOUT_MS', 'DOUBAO_TTS_TIMEOUT_MS') || 90_000);
  return Number.isFinite(value) ? value : 90_000;
}

function redactSecret(text: string, apiKey: string) {
  let safeText = text;
  if (apiKey) safeText = safeText.split(apiKey).join('[REDACTED]');
  return safeText
    .replace(/("?(?:api[_-]?key|authorization|x-api-key)"?\s*[:=]\s*"?)[^"\s,;}]+/gi, '$1[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
}

function buildPayload(text: string, speaker: string, uid: string) {
  return {
    user: { uid },
    req_params: {
      text,
      speaker,
      audio_params: {
        format: audioFormat(),
        sample_rate: sampleRate(),
      },
    },
  };
}

function parsePayloads(rawBody: string): unknown[] {
  const trimmed = rawBody.trim();
  if (!trimmed) return [];
  try {
    return [JSON.parse(trimmed)];
  } catch {
    const payloads: unknown[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
      const rawCandidate = line.trim();
      if (!rawCandidate || rawCandidate === '[DONE]' || rawCandidate === 'data: [DONE]') continue;
      const candidate = rawCandidate.startsWith('data:') ? rawCandidate.slice('data:'.length).trim() : rawCandidate;
      if (!candidate || candidate === '[DONE]') continue;
      try {
        payloads.push(JSON.parse(candidate));
      } catch {
        // Streaming endpoints can include keepalive lines. Ignore them and let
        // the caller fail clearly if no audio payload is found.
      }
    }
    return payloads;
  }
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

function readNestedStrings(payload: unknown, paths: string[][]): string[] {
  const values: string[] = [];
  for (const pathParts of paths) {
    const value = readNestedString(payload, [pathParts]);
    if (value) values.push(value);
  }
  return values;
}

function decodeAudioBase64(value: string): Buffer | null {
  const base64 = value.trim().startsWith('data:')
    ? value.slice(value.indexOf(',') + 1)
    : value.trim();
  if (!base64) return null;
  try {
    const buffer = Buffer.from(base64, 'base64');
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}

function summarizeUpstreamTtsPayloads(payloads: unknown[]): string {
  for (const payload of payloads) {
    if (!payload || typeof payload !== 'object') continue;
    const record = payload as Record<string, unknown>;
    const code = record.code ?? (record.header && typeof record.header === 'object' ? (record.header as Record<string, unknown>).code : undefined);
    const message = record.message ?? (record.header && typeof record.header === 'object' ? (record.header as Record<string, unknown>).message : undefined);
    if (code !== undefined || message !== undefined) {
      return `code=${String(code ?? 'unknown')}; message=${String(message ?? 'unknown')}`;
    }
  }
  return '';
}

async function storeAudio(buffer: Buffer, contentType: string, filePrefix: string) {
  const format = contentType.includes('mpeg') || contentType.includes('mp3') ? 'mp3' : audioFormat();
  const stored = await storeFile(buffer, `${filePrefix}-${Date.now()}.${format}`, contentType || `audio/${format}`);
  return resolveFileUrl(stored.key);
}

export async function synthesizeDoubaoAgentPlanTts(text: string, options?: DoubaoAgentPlanTtsOptions): Promise<DoubaoAgentPlanTtsResult> {
  const normalizedText = text.trim();
  if (!normalizedText) throw new Error('Missing text parameter');

  const apiKey = resolveApiKey(options);
  const speaker = resolveSpeaker(options);
  const resourceId = resolveResourceId();
  const endpoint = resolveEndpoint();
  if (!endpoint || !apiKey || !speaker || !resourceId) {
    throw new Error('豆包语音合成配置不完整：需要 endpoint、服务密钥、Resource-Id 和 speaker。');
  }

  const maxChars = Math.max(1, Math.min(2000, options?.maxChars || Number(readEnv('AGENTPLAN_TTS_ROUTE_MAX_CHARS', 'DOUBAO_TTS_ROUTE_MAX_CHARS') || 1000)));
  const truncatedText = normalizedText.length > maxChars ? normalizedText.slice(0, maxChars) : normalizedText;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'X-Api-Key': apiKey,
      'X-Api-Resource-Id': resourceId,
      'Resource-Id': resourceId,
      'Content-Type': 'application/json',
      Accept: 'application/json, audio/*',
    },
    signal: AbortSignal.timeout(timeoutMs()),
    body: JSON.stringify(buildPayload(truncatedText, speaker, options?.uid || 'lingbi-studio-tts')),
  });

  const contentType = res.headers.get('content-type') || '';
  if (contentType.toLowerCase().startsWith('audio/') || contentType.toLowerCase().includes('application/octet-stream')) {
    const audioBuffer = Buffer.from(await res.arrayBuffer());
    const audioUri = await storeAudio(audioBuffer, contentType || 'audio/mpeg', options?.filePrefix || 'tts');
    return {
      audioUri,
      audioUrl: audioUri,
      audioSize: audioBuffer.length,
      provider: 'doubao-tts-v3',
      contentType: contentType || 'audio/mpeg',
      textLength: truncatedText.length,
    };
  }

  const rawBody = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`豆包语音合成 API error: ${res.status}${rawBody ? ` - ${redactSecret(rawBody.slice(0, 800), apiKey)}` : ''}`);
  }

  const payloads = parsePayloads(rawBody);
  const upstreamSummary = summarizeUpstreamTtsPayloads(payloads);
  if (/55000000|resource id is mismatched with speaker related resource/i.test(upstreamSummary)) {
    throw new Error(`豆包语音合成音色与 Resource-Id 不匹配：当前 Resource-Id=${resourceId} 不能使用该 speaker，请在 Agent Plan 控制台复制同一语音模型下的匹配音色后重试。上游返回 ${upstreamSummary}`);
  }
  for (const payload of payloads) {
    const audioUrl = readNestedString(payload, [
      ['audioUri'],
      ['audioUrl'],
      ['audio_url'],
      ['url'],
      ['data', 'audioUri'],
      ['data', 'audioUrl'],
      ['data', 'audio_url'],
      ['data', 'url'],
      ['result', 'audioUri'],
      ['result', 'audioUrl'],
      ['result', 'audio_url'],
      ['result', 'url'],
    ]);
    if (audioUrl) {
      return {
        audioUri: audioUrl,
        audioUrl,
        audioSize: 0,
        provider: 'doubao-tts-v3',
        contentType: 'audio/mpeg',
        textLength: truncatedText.length,
      };
    }
  }

  const audioBuffers: Buffer[] = [];
  for (const payload of payloads) {
    const audioBase64Values = readNestedStrings(payload, [
      ['audio'],
      ['audio_data'],
      ['audioData'],
      ['data'],
      ['data', 'audio'],
      ['data', 'audio_data'],
      ['data', 'audioData'],
      ['result', 'audio'],
      ['result', 'audio_data'],
      ['result', 'audioData'],
    ]);
    for (const audioBase64 of audioBase64Values) {
      const audioBuffer = decodeAudioBase64(audioBase64);
      if (audioBuffer) audioBuffers.push(audioBuffer);
    }
  }
  if (audioBuffers.length > 0) {
    const audioBuffer = Buffer.concat(audioBuffers);
    const audioUri = await storeAudio(audioBuffer, `audio/${audioFormat()}`, options?.filePrefix || 'tts');
    return {
      audioUri,
      audioUrl: audioUri,
      audioSize: audioBuffer.length,
      provider: 'doubao-tts-v3',
      contentType: `audio/${audioFormat()}`,
      textLength: truncatedText.length,
    };
  }

  throw new Error(`豆包语音合成接口未返回音频 URL 或音频数据: ${redactSecret(rawBody.slice(0, 800), apiKey)}`);
}
