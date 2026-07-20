import type { NextRequest } from 'next/server';
import { getAccountApiBase } from '@/lib/account-auth-client';
import { bearerTokenFromRequest } from '@/lib/account-session';

const NO_STORE = { 'Cache-Control': 'no-store' };
const PROFILE_PATH = '/v1/me/provider-key-profile';

async function forward(request: NextRequest, method: 'GET' | 'PUT' | 'DELETE') {
  const token = bearerTokenFromRequest(request);
  if (!token) return Response.json({ error: 'not_authenticated' }, { status: 401, headers: NO_STORE });
  const baseUrl = getAccountApiBase();
  if (!baseUrl) return Response.json({ error: 'account_api_not_configured' }, { status: 503, headers: NO_STORE });

  const body = method === 'PUT' ? JSON.stringify(await request.json()) : undefined;
  const response = await fetch(`${baseUrl}${PROFILE_PATH}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({ error: 'account_provider_profile_invalid_response' }));
  return Response.json(payload, { status: response.status, headers: NO_STORE });
}

export function GET(request: NextRequest) {
  return forward(request, 'GET');
}

export function PUT(request: NextRequest) {
  return forward(request, 'PUT');
}

export function DELETE(request: NextRequest) {
  return forward(request, 'DELETE');
}
