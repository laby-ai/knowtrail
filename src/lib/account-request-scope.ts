import type { NextRequest } from 'next/server';
import { accountAuthRequired, resolveAccountSessionFromRequest } from '@/lib/account-session';
import { normalizeNotebookId } from '@/lib/notebook-scope';
import { paperHostLoginRequiredResponse, readPaperHostRequestScope } from '@/lib/paper-host-request-scope';

export interface AccountNotebookScope {
  tenantId?: string;
  ownerMemberId?: string;
  notebookId?: string;
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
  if (paperHostScope.enabled) {
    if (!paperHostScope.ready) {
      return {
        ok: false,
        response: paperHostLoginRequiredResponse(input.loginMessage),
      };
    }
    if (input.requireAuthenticatedPaperHost && paperHostScope.accountScope === 'guest') {
      return {
        ok: false,
        response: paperHostLoginRequiredResponse(input.loginMessage),
      };
    }
    return {
      ok: true,
      ownerMemberId: paperHostScope.ownerMemberId,
      notebookId: normalizeNotebookId(input.notebookId),
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
