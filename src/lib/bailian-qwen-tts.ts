import type { MemberProviderProfile } from '@/lib/account-entitlement-client';
import { resolveFileUrl, storeFile } from '@/lib/storage';

type QwenTtsResponse = {
  output?: { audio?: { url?: string }; url?: string };
  url?: string;
  code?: string;
};

function endpoint(profile: MemberProviderProfile): string {
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(profile.workspace_id)) throw new Error('百炼业务空间 ID 格式无效。');
  if (profile.region !== 'cn-beijing') throw new Error('当前仅支持百炼华北 2（北京）业务空间。');
  return `https://${profile.workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`;
}

export async function synthesizeBailianQwenTts(
  text: string,
  profile: MemberProviderProfile,
  options?: { voice?: string; signal?: AbortSignal },
) {
  const normalized = text.trim();
  if (!normalized) throw new Error('Missing text parameter');
  const bounded = normalized.slice(0, 1000);
  const timeout = AbortSignal.timeout(Math.max(15_000, Number(process.env.BAILIAN_TTS_TIMEOUT_MS || 90_000)));
  const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(endpoint(profile), {
    method: 'POST',
    headers: { Authorization: `Bearer ${profile.api_key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: profile.tts_model,
      input: {
        text: bounded,
        voice: options?.voice || 'longanhuan_v3.6',
        format: 'wav',
        sample_rate: 24000,
      },
    }),
    signal,
  });
  const payload = await response.json().catch(() => ({})) as QwenTtsResponse;
  if (!response.ok) throw new Error(`百炼语音合成失败（HTTP ${response.status}${payload.code ? `，${payload.code}` : ''}）。`);
  const audioUrl = payload.output?.audio?.url || payload.output?.url || payload.url;
  if (!audioUrl) throw new Error('百炼语音模型未返回音频。');
  const audioResponse = await fetch(audioUrl, { signal });
  if (!audioResponse.ok) throw new Error(`百炼音频下载失败（HTTP ${audioResponse.status}）。`);
  const contentType = audioResponse.headers.get('content-type') || 'audio/wav';
  if (!contentType.startsWith('audio/') && !contentType.includes('octet-stream')) throw new Error('百炼音频响应类型无效。');
  const buffer = Buffer.from(await audioResponse.arrayBuffer());
  const stored = await storeFile(buffer, `tts-${Date.now()}.wav`, 'audio/wav');
  const audioUri = await resolveFileUrl(stored.key);
  return {
    audioUri,
    audioUrl: audioUri,
    audioSize: buffer.length,
    provider: 'aliyun-bailian-qwen-audio-tts' as const,
    model: profile.tts_model,
    contentType: 'audio/wav',
    textLength: bounded.length,
  };
}
