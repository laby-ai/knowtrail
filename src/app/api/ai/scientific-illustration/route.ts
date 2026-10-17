import type { NextRequest } from 'next/server';
import { AccountServiceError } from '@/lib/account-entitlement-client';
import { accountUsageErrorMessage, reserveAIUsage, type AIUsageReservation } from '@/lib/account-ai-billing';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { buildScientificIllustrationPrompt, parseScientificIllustrationRequest } from '@/lib/scientific-illustration-contract';
import { saveScientificIllustration } from '@/lib/scientific-illustration-store';
import { generateSlideImage, resolveImageModelName, resolveImageRuntimeConfig } from '@/lib/ppt/image-generation';
import { resolveStudioGenerationReadiness, studioGenerationUnavailablePayload } from '@/lib/studio-generation-readiness';
import { readNotebookDocument, saveNotebookDocument, NotebookDocumentConflict } from '@/lib/private-notebook-document';
import { isIllustrationDocument, type IllustrationDocument, type IllustrationResult } from '@/lib/scientific-illustration-document';
import { getIngestionSource } from '@/lib/ingestion-store';
import { sourceBibliography } from '@/lib/source-bibliography';

const headers = { 'Cache-Control': 'private, no-store' };
const running = new Map<string, { runId: string; controller: AbortController }>();
function errorResponse(error: string, errorType: string, status: number) { return Response.json({ error, msg: error, errorType }, { status, headers }); }

export async function POST(request: NextRequest) {
  let reservation: AIUsageReservation | null = null;
  let finalized = false;
  let activeSignal: AbortSignal | undefined;
  let release: (() => void) | undefined;
  try {
    const raw = await request.json().catch(() => null) as Record<string, unknown> | null;
    let input;
    try { input = parseScientificIllustrationRequest(raw); }
    catch (error) { return errorResponse(error instanceof Error ? error.message : '参数不正确。', 'scientific_illustration_invalid_request', 400); }
    const readiness = resolveStudioGenerationReadiness().scientificIllustration;
    if (!readiness.ready) return Response.json(studioGenerationUnavailablePayload(readiness), { status: 503, headers });
    const account = await resolveAccountNotebookScope(request, { notebookId: input.notebookId, loginMessage: '请先登录后再生成科研示意图。', requireAuthenticatedPaperHost: true });
    if (!account.ok) return account.response;
    if (!account.ownerMemberId || !account.notebookId) return errorResponse('请先登录并打开文献本。', 'scientific_illustration_scope_required', 401);
    const scope = { ownerMemberId: account.ownerMemberId, notebookId: account.notebookId };
    const persist = raw?.persistArtifact === true;
    const expectedRevision = raw?.expectedRevision;
    const runId = typeof raw?.runId === 'string' ? raw.runId : '';
    let previous = null;
    if (persist) {
      if (!/^[a-f0-9-]{36}$/i.test(runId) || expectedRevision !== null && typeof expectedRevision !== 'string') return errorResponse('生成标识或保存版本不完整，请重新读取。', 'scientific_illustration_invalid_request', 400);
      previous = await readNotebookDocument<IllustrationDocument>(scope, 'scientific-illustration');
      if (previous && !isIllustrationDocument(previous.data)) throw new Error('已保存图片信息校验失败。');
      if (previous?.data.runId === runId && previous.data.result) return Response.json({ data: previous.data.result, document: previous }, { headers });
      if ((previous?.revision || null) !== expectedRevision) throw new NotebookDocumentConflict();
    }
    const taskKey = JSON.stringify([scope.ownerMemberId, scope.notebookId]);
    if (running.has(taskKey)) return errorResponse('当前文献本正在生成图片，请等待完成或停止。', 'scientific_illustration_busy', 409);
    const active = { runId, controller: new AbortController() }; running.set(taskKey, active);
    release = () => { if (running.get(taskKey) === active) running.delete(taskKey); };
    const signal = AbortSignal.any([request.signal, active.controller.signal]); activeSignal = signal;
    const sources = await Promise.all(input.papers.map(paper => getIngestionSource(paper.id, scope)));
    if (sources.some(source => !source)) return errorResponse('所选资料不存在或不属于当前文献本。', 'scientific_illustration_source_not_found', 404);
    input = { ...input, papers: sources.map(source => ({ id: source!.id, title: source!.title, shortName: source!.shortName || source!.title, abstract: '', content: source!.rawContent || source!.chunks.map(chunk => chunk.text).join(''), ...sourceBibliography(source!) })) };
    if (input.papers.reduce((sum, paper) => sum + paper.content.length, 0) > 18000) return errorResponse('所选原文过长，请缩小资料范围后作图；原文未截断。', 'scientific_illustration_evidence_too_long', 422);
    const runtimeConfig = resolveImageRuntimeConfig();
    try {
      reservation = await reserveAIUsage({ route: 'scientific-illustration', productArea: 'ai.image', modelName: resolveImageModelName(runtimeConfig), units: 1, inputText: input.purpose, memberId: scope.ownerMemberId, quotaExempt: account.usageQuotaExempt, idempotencyKey: request.headers.get('idempotency-key') || undefined });
    } catch (error) { return errorResponse(accountUsageErrorMessage(error, '科研示意图额度预占失败，请重试。'), error instanceof AccountServiceError ? error.code : 'account_billing_failed', error instanceof AccountServiceError ? error.status : 402); }
    const generated = await generateSlideImage(buildScientificIllustrationPrompt(input), { aspectRatio: input.aspectRatio, negativePrompt: 'statistical chart, axes, significance stars, measured values, fabricated data, watermark, advertisement, random English, dense tiny text', runtimeConfig, signal });
    signal.throwIfAborted();
    if (!generated) throw new Error('图片模型未返回可用图片。');
    const image = Buffer.from(generated.replace(/^data:image\/(?:png|jpe?g|webp);base64,/i, '').trim(), 'base64');
    const metadata = await saveScientificIllustration({ image, ...scope, purpose: input.purpose, figureKind: input.figureKind, aspectRatio: input.aspectRatio, sourceLabels: input.papers.map(paper => paper.shortName) });
    if (reservation) await reservation.settle(1); finalized = true;
    signal.throwIfAborted();
    const base = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
    const imageUrl = `${base}/api/ai/scientific-illustration/${metadata.id}?${new URLSearchParams({ notebookId: scope.notebookId })}`;
    const result: IllustrationResult = { id: metadata.id, imageUrl, downloadUrl: imageUrl + '&download=1', mimeType: metadata.mimeType, width: metadata.width, height: metadata.height, bytes: metadata.bytes, purpose: metadata.purpose, figureKind: metadata.figureKind, aspectRatio: metadata.aspectRatio, sourceLabels: metadata.sourceLabels, createdAt: metadata.createdAt, reviewRequired: true, boundary: '科研示意图，不是数据图表；科学含义、标签和文字仍需人工复核。' };
    if (!persist) return Response.json({ data: result }, { headers });
    const data: IllustrationDocument = { runId, form: { purpose: input.purpose, figureKind: input.figureKind, aspectRatio: input.aspectRatio, requiredLabels: input.requiredLabels.join('、') }, result };
    try { return Response.json({ data: result, document: await saveNotebookDocument(scope, 'scientific-illustration', data, expectedRevision as string | null) }, { headers }); }
    catch (error) { return Response.json({ data: result, unsavedDocument: data, saveError: error instanceof NotebookDocumentConflict ? error.message : '图片已生成但尚未保存，请重试保存。' }, { headers }); }
  } catch (error) {
    if (reservation && !finalized) await reservation.release().catch(() => undefined);
    return errorResponse(error instanceof NotebookDocumentConflict ? error.message : activeSignal?.aborted ? '已停止科研示意图生成。' : '科研示意图暂时无法生成，请重试。', 'scientific_illustration_failed', error instanceof NotebookDocumentConflict ? 409 : activeSignal?.aborted ? 499 : 503);
  } finally { release?.(); }
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => null) as { notebookId?: unknown; runId?: unknown } | null;
  const account = await resolveAccountNotebookScope(request, { notebookId: body?.notebookId, loginMessage: '请先登录。', requireAuthenticatedPaperHost: true });
  if (!account.ok) return account.response;
  const active = running.get(JSON.stringify([account.ownerMemberId, account.notebookId]));
  const cancelled = Boolean(active && active.runId === body?.runId); if (cancelled) active!.controller.abort();
  return Response.json({ cancelled }, { headers });
}
