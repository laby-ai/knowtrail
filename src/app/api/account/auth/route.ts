import { NextRequest, NextResponse } from 'next/server';
import { loginAccountUser, registerAccountUser } from '@/lib/account-auth-client';

type AuthPayload = {
  mode?: 'login' | 'register';
  email?: string;
  password?: string;
  displayName?: string;
};

function cleanEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json() as AuthPayload;
    const mode = payload.mode === 'register' ? 'register' : 'login';
    const email = cleanEmail(payload.email);
    const password = cleanText(payload.password);
    const displayName = cleanText(payload.displayName);

    if (!email || !password) {
      return NextResponse.json({ error: '请填写邮箱和密码。' }, { status: 400 });
    }
    if (mode === 'register' && !displayName) {
      return NextResponse.json({ error: '请填写昵称。' }, { status: 400 });
    }

    const session = mode === 'register'
      ? await registerAccountUser({ email, password, displayName })
      : await loginAccountUser({ email, password });

    return NextResponse.json(session, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'account_auth_failed';
    const status = /already/i.test(message) ? 409 : /not_configured/i.test(message) ? 503 : 401;
    return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
