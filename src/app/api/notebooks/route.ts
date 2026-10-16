import { NextRequest } from 'next/server';
import type { WorkbenchPreferences, WorkspaceNotebook } from '@/components/home/workspace-types';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { getNotebookCatalog, saveNotebookCatalog, NotebookCatalogConflict } from '@/lib/notebook-catalog-store';

async function accountScope(request: NextRequest) {
  const scope = await resolveAccountNotebookScope(request, {
    loginMessage: '请先登录，再同步文献本。',
  });
  if (!scope.ok) return scope;
  if (!scope.usageQuotaExempt || !scope.ownerMemberId) {
    return {
      ok: false as const,
      response: Response.json(
        { error: '游客文献本仅保存在当前浏览器。', errorType: 'account_login_required' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      ),
    };
  }
  return scope;
}

export async function GET(request: NextRequest) {
  const scope = await accountScope(request);
  if (!scope.ok) return scope.response;
  try {
    const catalog = await getNotebookCatalog(scope.ownerMemberId!);
    return Response.json({ catalog }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: '文献本列表暂时无法读取，请重试。' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}

export async function PUT(request: NextRequest) {
  const scope = await accountScope(request);
  if (!scope.ok) return scope.response;
  const input = await request.json().catch(() => null) as {
    notebooks?: WorkspaceNotebook[];
    activeNotebookId?: string | null;
    workbenchPreferences?: WorkbenchPreferences;
    expectedRevision?: string | null;
  } | null;
  if (!input || !Array.isArray(input.notebooks) || input.notebooks.length === 0) {
    return Response.json({ error: 'notebooks are required' }, { status: 400 });
  }
  try {
  const catalog = await saveNotebookCatalog(scope.ownerMemberId!, {
    notebooks: input.notebooks,
    activeNotebookId: input.activeNotebookId,
    workbenchPreferences: input.workbenchPreferences,
    expectedRevision: input.expectedRevision,
  });
  return Response.json({ catalog }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof NotebookCatalogConflict ? error.message : '文献本列表尚未保存，请重试。' }, { status: error instanceof NotebookCatalogConflict ? 409 : 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
