import { NextRequest, NextResponse } from 'next/server';
import { embedTexts, llmInvoke } from '@/lib/ai-service';
import {
  redactRuntimeAISecrets,
  resolveOpenAIChatEndpoint,
  resolveOpenAIEmbeddingsEndpoint,
  resolveServerRuntimeAIConfig,
} from '@/lib/runtime-ai-config';
import type { RuntimeAIConfig } from '@/types';

const VISION_TEST_TIMEOUT_MS = 60000;
const EMBEDDING_TEST_TIMEOUT_MS = 30000;
const TINY_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFklEQVR4nGP4TyFgGDVg1IBRA4aLAQBdePwur/3haQAAAABJRU5ErkJggg==';

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const TEXT_TEST_TIMEOUT_MS = readPositiveIntEnv('AI_TEST_CONFIG_TEXT_TIMEOUT_MS', 45000);
const VISION_TIMEOUT_MS = readPositiveIntEnv('AI_TEST_CONFIG_VISION_TIMEOUT_MS', VISION_TEST_TIMEOUT_MS);
const EMBEDDING_TIMEOUT_MS = readPositiveIntEnv('AI_TEST_CONFIG_EMBEDDING_TIMEOUT_MS', EMBEDDING_TEST_TIMEOUT_MS);

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('模型服务连接测试超时，请稍后再试。')), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export async function POST(request: NextRequest) {
  let apiKeyForRedaction = '';
  try {
    const { aiConfig } = await request.json() as { aiConfig?: Partial<RuntimeAIConfig> };
    const runtimeConfig = resolveServerRuntimeAIConfig(aiConfig);
    apiKeyForRedaction = runtimeConfig.apiKey || aiConfig?.apiKey || '';

    if (!runtimeConfig.apiBase?.trim() || !runtimeConfig.apiKey?.trim()) {
      return NextResponse.json({ ok: false, error: '账号绑定的模型服务尚未配置，请稍后再试。' }, { status: 400 });
    }

    try {
      resolveOpenAIChatEndpoint(runtimeConfig);
      if (runtimeConfig.embeddingModel?.trim()) {
        resolveOpenAIEmbeddingsEndpoint(runtimeConfig);
      }
    } catch (error: unknown) {
      const message = redactRuntimeAISecrets(
        error instanceof Error ? error.message : '模型服务配置不正确',
        runtimeConfig.apiKey,
      );
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }

    const content = await withTimeout(
      llmInvoke(
        [
          { role: 'system', content: 'You are a connectivity test endpoint. Reply with exactly OK.' },
          { role: 'user', content: 'Return OK.' },
        ],
        { temperature: 0, model: runtimeConfig.model?.trim() || undefined },
        undefined,
        runtimeConfig,
      ),
      TEXT_TEST_TIMEOUT_MS,
    );

    const visionModel = runtimeConfig.visionModel?.trim();
    let visionSample: string | undefined;
    if (visionModel) {
      visionSample = await withTimeout(
        llmInvoke(
          [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'This is a 1x1 test image. Reply with exactly VISION_OK.' },
                { type: 'image_url', image_url: { url: TINY_PNG_DATA_URL } },
              ],
            },
          ],
          { temperature: 0, model: visionModel, vision: true },
          undefined,
          runtimeConfig,
        ),
        VISION_TIMEOUT_MS,
      );
    }

    const embeddingModel = runtimeConfig.embeddingModel?.trim();
    let embeddingDimension: number | undefined;
    if (embeddingModel) {
      const embeddings = await withTimeout(
        embedTexts(['lingbi vector connectivity test'], runtimeConfig),
        EMBEDDING_TIMEOUT_MS,
      );
      embeddingDimension = embeddings[0]?.length;
    }

    return NextResponse.json({
      ok: true,
      model: runtimeConfig.model?.trim() || 'default',
      visionModel: visionModel || undefined,
      embeddingModel: embeddingModel || undefined,
      ttsSpeaker: runtimeConfig.ttsSpeaker?.trim() || undefined,
      sample: content.slice(0, 80),
      visionSample: visionSample?.slice(0, 80),
      embeddingDimension,
    });
  } catch (error: unknown) {
    const message = redactRuntimeAISecrets(
      error instanceof Error ? error.message : '连接测试失败',
      apiKeyForRedaction,
    );
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
