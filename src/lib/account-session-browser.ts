'use client';

import type { AccountAuthSession } from '@/lib/account-auth-client';

const ACCOUNT_SESSION_KEY = 'knowtrail-account-session';
const ACCOUNT_CENTER_TOKEN_KEY = 'account_entitlement_token';

function readAccountCenterToken(): string {
  try {
    return (
      window.localStorage.getItem(ACCOUNT_CENTER_TOKEN_KEY) ||
      window.sessionStorage.getItem(ACCOUNT_CENTER_TOKEN_KEY) ||
      ''
    );
  } catch {
    return '';
  }
}

function placeholderSessionFromToken(token: string): AccountAuthSession {
  return {
    token,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    tenant_id: '',
    tenant_name: '',
    member: {
      id: 'account-center-token',
      display_name: '当前账号',
      email: '',
      role_key: 'member',
      status: 'active',
    },
  };
}

export function readStoredAccountSession(): AccountAuthSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ACCOUNT_SESSION_KEY);
    if (!raw) {
      const accountCenterToken = readAccountCenterToken();
      return accountCenterToken ? placeholderSessionFromToken(accountCenterToken) : null;
    }
    const parsed = JSON.parse(raw) as AccountAuthSession;
    if (!parsed.token || !parsed.member?.id) return null;
    if (parsed.expires_at && Date.parse(parsed.expires_at) <= Date.now()) {
      window.localStorage.removeItem(ACCOUNT_SESSION_KEY);
      const accountCenterToken = readAccountCenterToken();
      return accountCenterToken ? placeholderSessionFromToken(accountCenterToken) : null;
    }
    return parsed;
  } catch {
    const accountCenterToken = readAccountCenterToken();
    return accountCenterToken ? placeholderSessionFromToken(accountCenterToken) : null;
  }
}

export function saveAccountSession(session: AccountAuthSession): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACCOUNT_SESSION_KEY, JSON.stringify(session));
  window.localStorage.setItem(ACCOUNT_CENTER_TOKEN_KEY, session.token);
  window.dispatchEvent(new CustomEvent('knowtrail-account-session-changed'));
}

export function clearAccountSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ACCOUNT_SESSION_KEY);
  window.localStorage.removeItem(ACCOUNT_CENTER_TOKEN_KEY);
  window.sessionStorage.removeItem(ACCOUNT_CENTER_TOKEN_KEY);
  window.dispatchEvent(new CustomEvent('knowtrail-account-session-changed'));
}

export async function revokeStoredAccountSession(): Promise<void> {
  const session = readStoredAccountSession();
  if (!session?.token) {
    clearAccountSession();
    return;
  }
  const response = await fetch('/api/account/session', {
    method: 'POST',
    cache: 'no-store',
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || 'account_logout_failed');
  }
  clearAccountSession();
}

export function accountAuthHeaders(): Record<string, string> {
  const session = readStoredAccountSession();
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
}
