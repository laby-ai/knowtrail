import { NextRequest } from 'next/server';
import { resolveAccountAuthContext, type AccountAuthContext } from '@/lib/account-auth-client';

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
  return resolveAccountAuthContext(token);
}
