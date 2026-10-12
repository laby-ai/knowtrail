import { NextRequest, NextResponse } from 'next/server';
import { getAccountApiBase } from '@/lib/account-auth-client';

export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object') throw new Error('invalid');
    const { token, password } = body as { token?: unknown; password?: unknown };
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return NextResponse.json({ error: '请使用邮件中的有效链接，并输入 8–128 位新密码。' }, { status: 400, headers });
    }
    const base = getAccountApiBase();
    if (!base) throw new Error('not_configured');
    const upstream = await fetch(`${base}/v1/auth/password-reset/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }), signal: AbortSignal.timeout(20_000), cache: 'no-store',
    });
    if (!upstream.ok) {
      const result = await upstream.json().catch(() => ({})) as { error?: string };
      const status = upstream.status === 429 ? 429 : upstream.status === 400 ? 400 : 502;
      const passwordError = result.error === 'password_too_short' || result.error === 'password_too_long';
      return NextResponse.json({ error: status === 429 ? '尝试次数过多，请稍后重试。' : passwordError ? '新密码需要 8–128 位。' : status === 400 ? '链接已过期、已使用或无效，请重新申请找回密码。' : '暂时无法重置密码，请稍后重试。' }, { status, headers });
    }
    return NextResponse.json({ status: 'ok', message: '密码已重置，请使用新密码重新登录。' }, { headers });
  } catch {
    return NextResponse.json({ error: '暂时无法处理重置请求，请稍后重试。' }, { status: 503, headers });
  }
}
