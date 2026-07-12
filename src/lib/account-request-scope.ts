import type { NextRequest } from 'next/server';
import { accountAuthRequired, resolveAccountSessionFromRequest } from '@/lib/account-session';
import { normalizeNotebookId } from '@/lib/notebook-scope';

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
  },
): Promise<AccountNotebookScopeResult> {
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
