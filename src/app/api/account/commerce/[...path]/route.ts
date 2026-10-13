import type { NextRequest } from 'next/server';
import { bearerTokenFromRequest } from '@/lib/account-session';
import { getAccountApiBase } from '@/lib/account-auth-client';
import { commerceAccount, CommerceError } from '@/lib/commerce/account-client';
import { prepareCommerceQuote } from '@/lib/commerce/quote';

const PUBLIC = new Set(['catalog', 'membership', 'preferences', 'teams', 'team-members', 'orders', 'invoice', 'refund', 'verify-email/request', 'verify-email/confirm']);
async function forward(request: NextRequest, params: Promise<{ path: string[] }>) {
  const path = (await params).path.join('/');
  try {
    if (path === 'quote' && request.method === 'POST') return Response.json(await prepareCommerceQuote(request));
    if ((path === 'payment/alipay' || path === 'payment/wechat') && request.method === 'POST') {
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > 65_536) return Response.json({ error: 'callback_too_large' }, { status: 413 });
      const headers = new Headers();
      for (const key of ['Content-Type', 'Wechatpay-Signature', 'Wechatpay-Serial', 'Wechatpay-Timestamp', 'Wechatpay-Nonce']) {
        const value = request.headers.get(key); if (value) headers.set(key, value);
      }
      const response = await fetch(`${getAccountApiBase()}/v1/lingbi/${path}`, { method: 'POST', body: bytes, headers, signal: AbortSignal.timeout(15_000) });
      return new Response(await response.text(), { status: response.status, headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store' } });
    }
    if (!PUBLIC.has(path)) return Response.json({ error: 'not_found' }, { status: 404 });
    const token = bearerTokenFromRequest(request);
    if (path !== 'catalog' && !token) return Response.json({ error: 'account_login_required' }, { status: 401 });
    const suffix = path === 'membership' && request.nextUrl.searchParams.get('accountId') ? `?accountId=${encodeURIComponent(request.nextUrl.searchParams.get('accountId')!)}` : '';
    const result = await commerceAccount(path + suffix, { token, body: request.method === 'POST' ? await request.json() : undefined });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return Response.json({ error: error instanceof CommerceError ? error.code : 'commerce_request_failed' }, { status: error instanceof CommerceError ? error.status : 400 }); }
}
export const GET = (request: NextRequest, context: { params: Promise<{ path: string[] }> }) => forward(request, context.params);
export const POST = (request: NextRequest, context: { params: Promise<{ path: string[] }> }) => forward(request, context.params);
