import { NextRequest, NextResponse } from 'next/server';
import { requestAccountPasswordReset } from '@/lib/account-auth-client';

type PasswordResetPayload = {
  email?: string;
};

function cleanEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 160;
}

function successMessage(delivery?: string): string {
  if (delivery === 'email') return '如果这个邮箱已注册，重置指引会发送到邮箱。';
  return '找回请求已提交；如果这个邮箱已注册，服务方会继续处理。';
}

function publicError(message: string): { status: number; error: string } {
  if (/not_configured/i.test(message)) {
    return { status: 503, error: '当前暂未开启自助找回，请联系服务方处理。' };
  }
  return { status: 502, error: '暂时无法提交找回请求，请稍后再试。' };
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json() as PasswordResetPayload;
    const email = cleanEmail(payload.email);
    if (!isValidEmail(email)) {
      return NextResponse.json(
        { error: '请输入有效邮箱。' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const result = await requestAccountPasswordReset({ email });
    return NextResponse.json(
      { status: 'ok', delivery: result.delivery, message: successMessage(result.delivery) },
      { status: 202, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'account_password_reset_failed';
    const mapped = publicError(message);
    return NextResponse.json(
      { error: mapped.error },
      { status: mapped.status, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
