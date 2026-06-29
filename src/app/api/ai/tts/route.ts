import { NextRequest, NextResponse } from 'next/server';
import { synthesizeDoubaoAgentPlanTts } from '@/lib/doubao-agentplan-tts';
import { allowRequestRuntimeAIConfig } from '@/lib/runtime-ai-config';

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'TTS synthesis failed';
  return message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
}

export async function POST(request: NextRequest) {
  try {
    const { text, speaker, aiConfig } = await request.json() as {
      text?: unknown;
      speaker?: unknown;
      aiConfig?: { apiKey?: unknown; ttsSpeaker?: unknown };
    };

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Missing text parameter' }, { status: 400 });
    }

    const requestApiKey = allowRequestRuntimeAIConfig() && typeof aiConfig?.apiKey === 'string'
      ? aiConfig.apiKey
      : undefined;

    const result = await synthesizeDoubaoAgentPlanTts(text, {
      apiKey: requestApiKey,
      speaker: typeof speaker === 'string'
        ? speaker
        : typeof aiConfig?.ttsSpeaker === 'string'
          ? aiConfig.ttsSpeaker
          : undefined,
      uid: 'ppt-v1-tts',
      filePrefix: 'tts',
      maxChars: 1000,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = safeErrorMessage(error);
    console.error('[TTS API Error]', message);
    const status = /missing|配置不完整/i.test(message)
      ? 400
      : /401|unauthori[sz]ed|invalid x-api-key|invalid api key|鉴权|认证/i.test(message)
        ? 401
        : /429|quota|rate.?limit|限流|额度/i.test(message)
          ? 429
          : 502;
    return NextResponse.json({ error: message, provider: 'doubao-tts-v3' }, { status });
  }
}
