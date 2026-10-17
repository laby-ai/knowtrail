import { getIngestionSource } from '@/lib/ingestion-store';
import { sourceBibliography } from '@/lib/source-bibliography';
import { NotebookDocumentConflict, readNotebookDocument, type PrivateNotebookScope } from '@/lib/private-notebook-document';
import { isHtmlDeckDocument, isImageDeckDocument, type PptDeckDocument, type PptDeckKind } from '@/lib/ppt/deck-document';
import { PptDeckAccessError, savePptDeckDocument } from '@/lib/ppt/deck-store';
import type { RagSourceInput } from '@/lib/rag';
import type { NextRequest } from 'next/server';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';

const running = new Map<string, { runId: string; controller: AbortController }>();
const runKey = (scope: PrivateNotebookScope, kind: PptDeckKind) => JSON.stringify([scope.ownerMemberId, scope.notebookId, kind]);
export interface DeckPersistenceInput { persistArtifact?: boolean; runId?: string; expectedRevision?: string | null }

export async function prepareDeckGeneration(input: DeckPersistenceInput, kind: PptDeckKind, scope: { ownerMemberId?: string; notebookId?: string }) {
  if (!input.persistArtifact) return null;
  if (!scope.ownerMemberId || !scope.notebookId) throw new PptDeckAccessError('请先登录并打开文献本。', 401);
  if (!input.runId || !/^[a-f0-9-]{36}$/i.test(input.runId) || input.expectedRevision !== null && typeof input.expectedRevision !== 'string') throw new PptDeckAccessError('生成标识或保存版本不完整，请重新读取。', 400);
  const verified: PrivateNotebookScope = { ownerMemberId: scope.ownerMemberId, notebookId: scope.notebookId };
  const previous = await readNotebookDocument<PptDeckDocument>(verified, kind);
  const validate = kind === 'image-deck' ? isImageDeckDocument : isHtmlDeckDocument;
  if (previous && !validate(previous.data)) throw new Error('已保存简报暂时无法读取。');
  if (previous?.data.runId === input.runId) return { previous, scope: verified, signal: undefined, release: () => undefined };
  if ((previous?.revision || null) !== input.expectedRevision) throw new NotebookDocumentConflict();
  const key = runKey(verified, kind);
  if (running.has(key)) throw new PptDeckAccessError('当前文献本正在生成简报，请等待完成或取消。', 409);
  const active = { runId: input.runId, controller: new AbortController() };
  running.set(key, active);
  return { previous: null, scope: verified, signal: active.controller.signal, release: () => { if (running.get(key) === active) running.delete(key); } };
}

export function cancelDeckGeneration(scope: PrivateNotebookScope, kind: PptDeckKind, runId: string) {
  const active = running.get(runKey(scope, kind));
  if (!active || active.runId !== runId) return false;
  active.controller.abort();
  return true;
}

export async function cancelDeckRequest(request: NextRequest, kind: PptDeckKind) {
  try {
    const body = await request.json() as { notebookId?: unknown; runId?: unknown };
    const scope = await resolveAccountNotebookScope(request, { notebookId: body.notebookId, loginMessage: '请先登录。', requireAuthenticatedPaperHost: true });
    if (!scope.ok) return scope.response;
    if (!scope.ownerMemberId || !scope.notebookId || typeof body.runId !== 'string') throw new PptDeckAccessError('取消请求不完整。', 400);
    return Response.json({ cancelled: cancelDeckGeneration({ ownerMemberId: scope.ownerMemberId, notebookId: scope.notebookId }, kind, body.runId) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return deckRequestFailure(error); }
}

export async function ownedDeckSources(papers: RagSourceInput[], scope: PrivateNotebookScope): Promise<RagSourceInput[]> {
  return Promise.all(papers.map(async paper => {
    if (!paper.id) throw new PptDeckAccessError('所选资料不存在，请重新选择。', 404);
    const source = await getIngestionSource(paper.id, scope);
    if (!source) throw new PptDeckAccessError('所选资料不存在或不属于当前文献本。', 404);
    return { id: source.id, title: source.title, fileName: source.fileName, ...sourceBibliography(source), rawContent: source.rawContent || source.chunks.map(chunk => chunk.text).join('\n') };
  }));
}

export function deckEvidence(papers: RagSourceInput[]) {
  const evidence = papers.map(paper => [
    `资料标题：${paper.title || paper.fileName || ''}`,
    paper.authors?.length ? `文献作者：${paper.authors.join('、')}` : '文献作者：未提供',
    paper.year ? `发表年份：${paper.year}` : '发表年份：未提供',
    '书目作者不是汇报人，发表年份不是数据采集年份；其他角色或时间只有原文明示才可使用。',
    paper.rawContent || '',
  ].join('\n')).join('\n\n---\n\n');
  if (evidence.length > 18000) throw new Error('所选资料过长，请缩小资料范围后生成，原文未截断。');
  return evidence;
}

export async function finishDeckGeneration(input: DeckPersistenceInput, kind: PptDeckKind, scope: PrivateNotebookScope | undefined, data: PptDeckDocument, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!input.persistArtifact || !scope) return {};
  try { return { document: await savePptDeckDocument(scope, kind, data, input.expectedRevision!) }; }
  catch (error) {
    return { unsavedDocument: data, saveError: error instanceof NotebookDocumentConflict ? error.message : '简报已生成但尚未保存，请重试保存。', conflict: error instanceof NotebookDocumentConflict };
  }
}

export function deckRequestFailure(error: unknown) {
  return Response.json({ error: error instanceof PptDeckAccessError || error instanceof NotebookDocumentConflict ? error.message : '简报暂时无法生成或读取，请重试。' }, { status: error instanceof PptDeckAccessError ? error.status : error instanceof NotebookDocumentConflict ? 409 : 503, headers: { 'Cache-Control': 'private, no-store' } });
}
