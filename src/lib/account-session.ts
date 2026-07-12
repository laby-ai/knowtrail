import { NextRequest } from 'next/server';
import { resolveAccountAuthContext, resolveZhiqiPortalAuthContext, type AccountAuthContext } from '@/lib/account-auth-client';

export function accountAuthRequired(): boolean {
  return process.env.ACCOUNT_CENTER_REQUIRE_AUTH?.trim().toLowerCase() === 'true';
}

export function bearerTokenFromRequest(request: NextRequest | Request): string {
  const auth = request.headers.get('authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
}

export async function resolveAccountSessionFromRequest(request: NextRequest | Request): Promise<AccountAuthContext | null> {
  const token = bearerTokenFromRequest(request);
  if (!token) return null;
  if (request.headers.get('x-zhiqi-host') === '1') {
    const tenantId = request.headers.get('tenant-id')?.trim() || '';
    if (!tenantId) throw new Error('zhiqi_tenant_required');
    return resolveZhiqiPortalAuthContext(token, tenantId);
  }
  return resolveAccountAuthContext(token);
}
