import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { bearerTokenFromRequest } from '@/lib/account-session';
import { commerceAccount, CommerceError } from '@/lib/commerce/account-client';
const input = z.object({ password: z.string().min(1).max(512), confirmation: z.literal('注销账号') }).strict();
async function handle(request: NextRequest, write: boolean) {
  const token = bearerTokenFromRequest(request);
  if (!token) return Response.json({ error: '请先登录。' }, { status: 401 });
  try {
    const body = write ? input.parse(await request.json()) : undefined;
    return Response.json(await commerceAccount('account-closure', { token, body }), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const status = error instanceof CommerceError ? error.status : 400;
    const code = error instanceof CommerceError ? error.code : '';
    return Response.json({ error: code === 'closure_password_invalid' ? '密码不正确，请重新输入。' : status === 429 ? '尝试过于频繁，请稍后重试。' : status === 401 ? '登录已失效，请重新登录。' : '注销申请暂时无法提交或读取，请检查输入后重试。' }, { status });
  }
}
export const GET = (request: NextRequest) => handle(request, false);
export const POST = (request: NextRequest) => handle(request, true);
