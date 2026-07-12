import type { NextRequest } from 'next/server';
import { AccountServiceError } from '@/lib/account-entitlement-client';
import { accountUsageErrorMessage, reserveAIUsage, type AIUsageReservation } from '@/lib/account-ai-billing';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import {
  buildScientificIllustrationPrompt,
  parseScientificIllustrationRequest,
} from '@/lib/scientific-illustration-contract';
import { saveScientificIllustration } from '@/lib/scientific-illustration-store';
import {
  generateSlideImage,
  resolveImageModelName,
  resolveImageRuntimeConfig,
} from '@/lib/ppt/image-generation';

function errorResponse(error: string, errorType: string, status: number) {
  return Response.json(
    { code: status === 400 ? 40002 : status, msg: error, error, status: 'failed', errorType },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function imageBufferFromBase64(value: string): Buffer {
  const normalized = value.replace(/^data:image\/(?:png|jpe?g|webp);base64,/i, '').trim();
  if (!normalized) throw new Error('图片模型未返回图片数据。');
  return Buffer.from(normalized, 'base64');
}

export async function POST(request: NextRequest) {
  let reservation: AIUsageReservation | null = null;
  let finalized = false;
  try {
    const raw = await request.json().catch(() => null);
    let input;
    try {
      input = parseScientificIllustrationRequest(raw);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : '科研示意图参数不正确。', 'scientific_illustration_invalid_request', 400);
    }

    const accountScope = await resolveAccountNotebookScope(request, {
      notebookId: input.notebookId,
      loginMessage: '请先登录后再生成科研示意图。',
    });
    if (!accountScope.ok) return accountScope.response;

    const runtimeConfig = resolveImageRuntimeConfig();
    const modelName = resolveImageModelName(runtimeConfig);
    try {
      reservation = await reserveAIUsage({
        route: 'scientific-illustration',
        productArea: 'ai.image',
        modelName,
        units: 1,
        inputText: input.purpose,
        memberId: accountScope.ownerMemberId,
        idempotencyKey: request.headers.get('idempotency-key') || undefined,
      });
    } catch (billingError) {
      const status = billingError instanceof AccountServiceError ? billingError.status : 402;
      const code = billingError instanceof AccountServiceError ? billingError.code : 'account_billing_failed';
      return errorResponse(accountUsageErrorMessage(billingError, '科研示意图额度预占失败，请检查账号额度后重试。'), code, status);
    }

    const prompt = buildScientificIllustrationPrompt(input);
    const generated = await generateSlideImage(prompt, {
      aspectRatio: input.aspectRatio,
      negativePrompt: 'statistical chart, axes, significance stars, measured values, fabricated data, watermark, advertisement, random English, dense tiny text',
      runtimeConfig,
      signal: request.signal,
    });
    if (!generated) throw new Error('图片模型未返回可用图片。');

    const metadata = await saveScientificIllustration({
      image: imageBufferFromBase64(generated),
      ownerMemberId: accountScope.ownerMemberId,
      notebookId: accountScope.notebookId,
      purpose: input.purpose,
      figureKind: input.figureKind,
      aspectRatio: input.aspectRatio,
      sourceLabels: input.papers.map(paper => paper.shortName),
    });
    if (reservation) await reservation.settle(1);
    finalized = true;

    const imageUrl = `/api/ai/scientific-illustration/${metadata.id}`;
    return Response.json({
      code: 0,
      msg: 'ok',
      data: {
        id: metadata.id,
        imageUrl,
        downloadUrl: `${imageUrl}?download=1`,
        mimeType: metadata.mimeType,
        width: metadata.width,
        height: metadata.height,
        bytes: metadata.bytes,
        purpose: metadata.purpose,
        figureKind: metadata.figureKind,
        aspectRatio: metadata.aspectRatio,
        sourceLabels: metadata.sourceLabels,
        createdAt: metadata.createdAt,
        reviewRequired: true,
        boundary: '科研示意图，不是数据图表；科学含义、标签和文字仍需人工复核。',
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (reservation && !finalized) await reservation.release().catch(() => undefined);
    if (request.signal.aborted) {
      return errorResponse('已停止科研示意图生成。', 'scientific_illustration_cancelled', 499);
    }
    const message = error instanceof Error ? error.message : '科研示意图生成失败。';
    console.error('[Scientific Illustration API]', message);
    const timeout = /timeout|timed out|aborted due to timeout/i.test(message);
    return errorResponse(
      timeout ? '图片模型响应超时，请缩短描述或稍后重试。' : message,
      timeout ? 'scientific_illustration_timeout' : 'scientific_illustration_failed',
      timeout ? 504 : 500,
    );
  }
}
