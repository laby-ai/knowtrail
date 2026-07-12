export type AccountMember = {
  id: string;
  display_name: string;
  email: string;
  role_key: string;
  status: string;
};

export type AccountAuthSession = {
  token: string;
  expires_at: string;
  tenant_id: string;
  tenant_name: string;
  member: AccountMember;
};

export type AccountAuthContext = Omit<AccountAuthSession, 'token' | 'expires_at'> & {
  expires_at?: string;
};

export type AccountPasswordResetResult = {
  status: string;
  delivery?: 'email' | 'manual_follow_up' | string;
  message?: string;
};

function envValue(name: string): string {
  return process.env[name]?.trim() || '';
}

export function getAccountApiBase(): string {
  return envValue('ACCOUNT_CENTER_API_BASE').replace(/\/$/, '');
}

function accountEndpoint(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function getPasswordResetEndpoint(baseUrl: string): string {
  return envValue('ACCOUNT_CENTER_PASSWORD_RESET_URL')
    || accountEndpoint(baseUrl, envValue('ACCOUNT_CENTER_PASSWORD_RESET_PATH') || '/v1/auth/password-reset/request');
}

async function readAccountResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload && typeof payload === 'object' && 'error' in payload
      ? String((payload as { error?: unknown }).error || 'account_request_failed')
      : 'account_request_failed';
    throw new Error(error);
  }
  return payload as T;
}

export async function loginAccountUser(input: { email: string; password: string }): Promise<AccountAuthSession> {
  const baseUrl = getAccountApiBase();
  if (!baseUrl) throw new Error('account_api_not_configured');
  const response = await fetch(`${baseUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readAccountResponse<AccountAuthSession>(response);
}

export async function registerAccountUser(input: {
  email: string;
  password: string;
  displayName: string;
  tenantId?: string;
}): Promise<AccountAuthSession> {
  const baseUrl = getAccountApiBase();
  if (!baseUrl) throw new Error('account_api_not_configured');
  const response = await fetch(`${baseUrl}/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      display_name: input.displayName,
      tenant_id: input.tenantId || envValue('ACCOUNT_CENTER_TENANT_ID') || 'tenant_acme',
    }),
  });
  return readAccountResponse<AccountAuthSession>(response);
}

export async function resolveAccountAuthContext(token: string): Promise<AccountAuthContext> {
  const baseUrl = getAccountApiBase();
  if (!baseUrl) throw new Error('account_api_not_configured');
  const response = await fetch(`${baseUrl}/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  return readAccountResponse<AccountAuthContext>(response);
}

export async function resolveZhiqiPortalAuthContext(token: string, tenantId: string): Promise<AccountAuthContext> {
  const endpoint = envValue('ZHIQI_PORTAL_AUTH_INFO_URL');
  if (!endpoint) throw new Error('zhiqi_portal_auth_not_configured');
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}`, 'tenant-id': tenantId },
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json().catch(() => null) as {
    code?: number;
    data?: { user?: { id?: number | string; nickname?: string; username?: string } };
  } | null;
  const user = payload?.code === 0 ? payload.data?.user : undefined;
  if (!response.ok || user?.id === undefined || user.id === null) throw new Error('invalid_zhiqi_portal_session');
  const username = String(user.username || user.id);
  return {
    tenant_id: tenantId,
    tenant_name: '北京国家会计学院',
    member: {
      id: `zhiqi:${tenantId}:${user.id}`,
      display_name: String(user.nickname || username),
      email: '',
      role_key: 'zhiqi_portal_user',
      status: 'active',
    },
  };
}

export async function logoutAccountUser(token: string): Promise<void> {
  const baseUrl = getAccountApiBase();
  if (!baseUrl) throw new Error('account_api_not_configured');
  const response = await fetch(`${baseUrl}/v1/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  await readAccountResponse<{ status: string }>(response);
}

export async function requestAccountPasswordReset(input: { email: string; tenantId?: string }): Promise<AccountPasswordResetResult> {
  const baseUrl = getAccountApiBase();
  if (!baseUrl) throw new Error('account_api_not_configured');
  const response = await fetch(getPasswordResetEndpoint(baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: input.email,
      tenant_id: input.tenantId || envValue('ACCOUNT_CENTER_TENANT_ID') || 'tenant_acme',
    }),
  });
  return readAccountResponse<AccountPasswordResetResult>(response);
}
