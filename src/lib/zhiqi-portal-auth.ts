'use client';

const TOKEN_KEY = 'zhiqi-portal-access-token';
const TENANT_KEY = 'zhiqi-portal-tenant-id';

export type ZhiqiPortalAuth = { accessToken: string; tenantId: string };

export function saveZhiqiPortalAuth(auth: ZhiqiPortalAuth): void {
  if (typeof window === 'undefined') return;
  const accessToken = auth.accessToken.trim();
  const tenantId = auth.tenantId.trim();
  if (!accessToken || !tenantId) return;
  window.sessionStorage.setItem(TOKEN_KEY, accessToken);
  window.sessionStorage.setItem(TENANT_KEY, tenantId);
}

export function clearZhiqiPortalAuth(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(TOKEN_KEY);
  window.sessionStorage.removeItem(TENANT_KEY);
}

export function readZhiqiPortalAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const accessToken = window.sessionStorage.getItem(TOKEN_KEY)?.trim() || '';
  const tenantId = window.sessionStorage.getItem(TENANT_KEY)?.trim() || '';
  return accessToken && tenantId ? {
    Authorization: `Bearer ${accessToken}`,
    'tenant-id': tenantId,
    'x-zhiqi-host': '1',
  } : {};
}

export function readZhiqiPortalAuth(): ZhiqiPortalAuth | null {
  if (typeof window === 'undefined') return null;
  const accessToken = window.sessionStorage.getItem(TOKEN_KEY)?.trim() || '';
  const tenantId = window.sessionStorage.getItem(TENANT_KEY)?.trim() || '';
  return accessToken && tenantId ? { accessToken, tenantId } : null;
}

function allowedPortalOrigins(): Set<string> {
  const configured = (process.env.NEXT_PUBLIC_ZHIQI_PORTAL_ORIGINS || '')
    .split(',').map(value => value.trim()).filter(Boolean);
  if (typeof window !== 'undefined') configured.push(window.location.origin);
  return new Set(configured);
}

export function installZhiqiPortalAuthBridge(onAuthenticated?: () => void): () => void {
  if (typeof window === 'undefined' || window.parent === window) return () => {};
  const allowedOrigins = allowedPortalOrigins();
  const receive = (event: MessageEvent) => {
    if (event.source !== window.parent || !allowedOrigins.has(event.origin)) return;
    const data = event.data as Partial<ZhiqiPortalAuth> & { type?: string };
    if (data?.type !== 'bnai:portal-auth') return;
    saveZhiqiPortalAuth({ accessToken: String(data.accessToken || ''), tenantId: String(data.tenantId || '') });
    onAuthenticated?.();
  };
  window.addEventListener('message', receive);
  window.parent.postMessage({ type: 'bnai:portal-auth-ready' }, '*');
  return () => window.removeEventListener('message', receive);
}
