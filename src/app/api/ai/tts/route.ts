import { NextRequest, NextResponse } from 'next/server';
import { synthesizeBailianQwenTts } from '@/lib/bailian-qwen-tts';
import { bailianProfileErrorResponse, resolveMemberBailianProfile } from '@/lib/bailian-provider-profile';

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'TTS synthesis failed';
  return message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
}

export async function POST(request: NextRequest) {
  try {
    const { text, speaker } = await request.json() as {
      text?: unknown;
      speaker?: unknown;
    };

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Missing text parameter' }, { status: 400 });
    }

    const profile = await resolveMemberBailianProfile(request);
    const result = await synthesizeBailianQwenTts(text, profile, {
      voice: typeof speaker === 'string' ? speaker : undefined,
      signal: request.signal,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const profileError = bailianProfileErrorResponse(error);
    if (profileError) return profileError;
    const message = safeErrorMessage(error);
    console.error('[TTS API Error]', message);
    const status = /missing|配置不完整/i.test(message)
      ? 400
      : /401|unauthori[sz]ed|invalid x-api-key|invalid api key|鉴权|认证/i.test(message)
        ? 401
        : /429|quota|rate.?limit|限流|额度/i.test(message)
          ? 429
          : 502;
    return NextResponse.json({ error: message, provider: 'aliyun-bailian-qwen-audio-tts' }, { status });
  }
}
