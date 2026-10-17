import type { NextRequest } from 'next/server';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { NotebookDocumentConflict, readNotebookDocument, saveNotebookDocument, type PrivateNotebookScope } from '@/lib/private-notebook-document';
import { isExperimentDocument, isHypothesisDocument, type ResearchDesignDocument, type ResearchDesignKind } from '@/lib/research-design-document';

export interface DesignPersistenceInput { persistArtifact?: boolean; expectedRevision?: string | null; runId?: string }
const running = new Map<string, { runId: string; controller: AbortController }>();
const key = (scope: PrivateNotebookScope, kind: ResearchDesignKind) => JSON.stringify([scope.ownerMemberId, scope.notebookId, kind]);
class DesignRequestError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export function designStorageFailure(error: unknown) { return Response.json({ error: error instanceof Error ? error.message : '内容暂时无法读取，请重试。' }, { status: error instanceof DesignRequestError ? error.status : error instanceof NotebookDocumentConflict ? 409 : 503, headers: { 'Cache-Control': 'private, no-store' } }); }
export async function prepareResearchDesign(input: DesignPersistenceInput, kind: ResearchDesignKind, scope: { ownerMemberId?: string; notebookId?: string }) {
  if (!input.persistArtifact) return null;
  if (!scope.ownerMemberId || !scope.notebookId) throw new DesignRequestError('请先登录并打开文献本。', 401);
  if (!input.runId || !/^[a-f0-9-]{36}$/i.test(input.runId) || input.expectedRevision !== null && typeof input.expectedRevision !== 'string') throw new DesignRequestError('生成标识或版本不完整，请重新读取。', 400);
  const verified = { ownerMemberId: scope.ownerMemberId, notebookId: scope.notebookId };
  const previous = await readNotebookDocument<ResearchDesignDocument>(verified, kind);
  const validate = kind === 'hypothesis-generation' ? isHypothesisDocument : isExperimentDocument;
  if (previous && !validate(previous.data)) throw new Error('已保存内容校验失败。');
  if (previous?.data.result?.runId === input.runId) return { scope: verified, previous, replay: true, signal: new AbortController().signal, release: () => undefined };
  if ((previous?.revision || null) !== input.expectedRevision) throw new NotebookDocumentConflict();
  const taskKey = key(verified, kind); if (running.has(taskKey)) throw new DesignRequestError('当前文献本正在生成，请等待完成或停止。', 409);
  const active = { runId: input.runId, controller: new AbortController() }; running.set(taskKey, active);
  return { scope: verified, previous, replay: false, signal: active.controller.signal, release: () => { if (running.get(taskKey) === active) running.delete(taskKey); } };
}
export async function finishResearchDesign(input: DesignPersistenceInput, kind: ResearchDesignKind, prepared: Awaited<ReturnType<typeof prepareResearchDesign>>, data: ResearchDesignDocument, signal: AbortSignal) {
  signal.throwIfAborted(); if (!prepared) return {};
  try { return { document: await saveNotebookDocument(prepared.scope, kind, data, input.expectedRevision!) }; }
  catch (error) { return { unsavedDocument: data, saveError: error instanceof NotebookDocumentConflict ? error.message : '内容已生成但尚未保存，请重试保存。' }; }
}
export async function cancelResearchDesign(request: NextRequest, kind: ResearchDesignKind) {
  try {
    const body = await request.json() as { notebookId?: unknown; runId?: unknown };
    const scope = await resolveAccountNotebookScope(request, { notebookId: body.notebookId, loginMessage: '请先登录。', requireAuthenticatedPaperHost: true });
    if (!scope.ok) return scope.response;
    if (!scope.ownerMemberId || !scope.notebookId || typeof body.runId !== 'string') throw new DesignRequestError('停止请求不完整。', 400);
    const active = running.get(key({ ownerMemberId: scope.ownerMemberId, notebookId: scope.notebookId }, kind));
    const cancelled = Boolean(active && active.runId === body.runId); if (cancelled) active!.controller.abort();
    return Response.json({ cancelled }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return designStorageFailure(error); }
}
