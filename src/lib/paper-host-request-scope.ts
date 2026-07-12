import type { NextRequest } from 'next/server';

export type PaperHostRequestScope =
  | {
      enabled: true;
      ready: true;
      ownerMemberId: string;
      workspaceKey: string;
      accountScope: string;
    }
  | {
      enabled: true;
      ready: false;
      ownerMemberId?: undefined;
      workspaceKey: string;
      accountScope: string;
    }
  | {
      enabled: false;
      ready: false;
      ownerMemberId?: undefined;
      workspaceKey: '';
      accountScope: '';
    };

function sanitizeScopeKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);
}

function readRefererParams(request: NextRequest): URLSearchParams {
  const referer = request.headers.get('referer');
  if (!referer) return new URLSearchParams();
  try {
    return new URL(referer).searchParams;
  } catch {
    return new URLSearchParams();
  }
}

export function readPaperHostRequestScope(request: NextRequest): PaperHostRequestScope {
  const refererParams = readRefererParams(request);
  const headerWorkspace = request.headers.get('x-paper-host-workspace') || '';
  const headerAccountScope = request.headers.get('x-paper-host-account-scope') || '';
  const workspaceKey = headerWorkspace || refererParams.get('workspaceKey') || '';
  const accountScope = headerAccountScope || refererParams.get('accountScope') || '';
  const enabled =
    request.headers.get('x-paper-host') === 'paper-web' ||
    refererParams.get('host') === 'paper-web' ||
    refererParams.get('embed') === 'research-agent';

  if (!enabled) {
    return {
      enabled: false,
      ready: false,
      workspaceKey: '',
      accountScope: '',
    };
  }

  const safeWorkspaceKey = sanitizeScopeKey(workspaceKey);
  if (!safeWorkspaceKey) {
    return {
      enabled: true,
      ready: false,
      workspaceKey: '',
      accountScope,
    };
  }

  return {
    enabled: true,
    ready: true,
    ownerMemberId: `paper-host:${safeWorkspaceKey}`,
    workspaceKey: safeWorkspaceKey,
    accountScope,
  };
}

export function paperHostLoginRequiredResponse(
  message = '请先登录国科大科教平台，再使用科研智能体。',
) {
  return Response.json({
    error: message,
    status: 'failed',
    errorType: 'paper_host_login_required',
  }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
}
