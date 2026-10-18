import type { NextRequest } from 'next/server';
import { accountAuthRequired, resolveAccountSessionFromRequest } from '@/lib/account-session';
import { normalizeNotebookId } from '@/lib/notebook-scope';
import { paperHostHighCostAuthRequired } from '@/lib/paper-host-high-cost-auth';
import { paperHostLoginRequiredResponse, readPaperHostRequestScope } from '@/lib/paper-host-request-scope';
import { PaperHostSessionError, paperHostSessionVerificationConfigured, verifiedPaperHostWorkspace } from '@/lib/verified-paper-host-session';

export interface AccountNotebookScope {
  tenantId?: string;
  ownerMemberId?: string;
  notebookId?: string;
  usageQuotaExempt: boolean;
}

export type AccountNotebookScopeResult =
  | ({ ok: true } & AccountNotebookScope)
  | { ok: false; response: Response };

export async function resolveAccountNotebookScope(
  request: NextRequest,
  input: {
    notebookId?: unknown;
    loginMessage: string;
    invalidMessage?: string;
    requireAuthenticatedPaperHost?: boolean;
  },
): Promise<AccountNotebookScopeResult> {
  const paperHostScope = readPaperHostRequestScope(request);
  if (paperHostSessionVerificationConfigured()) {
    try {
      const workspaceKey = await verifiedPaperHostWorkspace(request.headers);
      if (paperHostScope.enabled && paperHostScope.workspaceKey && paperHostScope.workspaceKey !== workspaceKey) {
        return { ok: false, response: Response.json({ error: '账号已切换，请重新打开文献本。' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } }) };
      }
      return {
        ok: true,
        ownerMemberId: `paper-host:${workspaceKey}`,
        notebookId: normalizeNotebookId(input.notebookId),
        usageQuotaExempt: true,
      };
    } catch (error) {
      return {
        ok: false,
        response: Response.json({ error: error instanceof PaperHostSessionError ? error.message : '账号服务暂不可用，请稍后重试。' }, {
          status: error instanceof PaperHostSessionError ? error.status : 503,
          headers: { 'Cache-Control': 'private, no-store' },
        }),
      };
    }
  }
  if (paperHostScope.enabled) {
    if (!paperHostScope.ready) {
      return {
        ok: false,
        response: paperHostLoginRequiredResponse(input.loginMessage),
      };
    }
    if (
      input.requireAuthenticatedPaperHost
      && paperHostHighCostAuthRequired()
      && paperHostScope.accountScope === 'guest'
    ) {
      return {
        ok: false,
        response: paperHostLoginRequiredResponse(input.loginMessage),
      };
    }
    return {
      ok: true,
      ownerMemberId: paperHostScope.ownerMemberId,
      notebookId: normalizeNotebookId(input.notebookId),
      usageQuotaExempt: paperHostScope.accountScope === 'current-user',
    };
  }

  try {
    const accountSession = await resolveAccountSessionFromRequest(request);
    if (accountAuthRequired() && !accountSession) {
      return {
        ok: false,
        response: Response.json({
          error: input.loginMessage,
          status: 'failed',
          errorType: 'account_login_required',
        }, { status: 401, headers: { 'Cache-Control': 'no-store' } }),
      };
    }
    return {
      ok: true,
      tenantId: accountSession?.tenant_id,
      ownerMemberId: accountSession?.member.id,
      notebookId: normalizeNotebookId(input.notebookId),
      usageQuotaExempt: Boolean(accountSession),
    };
  } catch {
    return {
      ok: false,
      response: Response.json({
        error: input.invalidMessage || '账号登录已过期，请重新登录。',
        status: 'failed',
        errorType: 'invalid_account_session',
      }, { status: 401, headers: { 'Cache-Control': 'no-store' } }),
    };
  }
}
