import { createHmac } from 'node:crypto';
import { getAccountApiBase } from '@/lib/account-auth-client';
import { assertApiResponse } from '@/lib/api-response';

export class CommerceError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}
export async function commerceAccount<T>(path: string, options: { token?: string; body?: unknown; internal?: boolean; signal?: AbortSignal } = {}): Promise<T> {
  const base = getAccountApiBase();
  if (!base) throw new CommerceError(503, 'account_service_not_configured');
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
  if (options.internal) {
    const secret = process.env.LINGBI_COMMERCE_INTERNAL_SECRET || '';
    if (secret.length < 32) throw new CommerceError(503, 'commerce_signature_not_configured');
    const timestamp = String(Math.floor(Date.now() / 1000));
    headers.set('X-Lingbi-Timestamp', timestamp);
    headers.set('X-Lingbi-Signature', createHmac('sha256', secret).update(`${timestamp}.${body || ''}`).digest('hex'));
  }
  const response = await fetch(`${base}/v1/lingbi/${path}`, { method: body ? 'POST' : 'GET', headers, body, cache: 'no-store', signal: options.signal || AbortSignal.timeout(15_000) });
  try { await assertApiResponse(response, '账号服务'); }
  catch (error) { throw new CommerceError(response.ok ? 502 : response.status, error instanceof Error ? error.message : '账号服务返回异常。'); }
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new CommerceError(response.status, data.error || 'commerce_request_failed');
  return data;
}
