import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { resolveAccountSessionFromRequest } from '@/lib/account-session';
import { readAppPreferences, saveAppPreferences } from '@/lib/app-preferences-store';

async function handle(request: NextRequest, write: boolean) {
  const session = await resolveAccountSessionFromRequest(request).catch(() => null);
  if (!session) return Response.json({ error: '请重新登录。' }, { status: 401 });
  try {
    const preferences = write ? await saveAppPreferences(session.member.id, await request.json()) : await readAppPreferences(session.member.id);
    return Response.json(preferences, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof z.ZodError || error instanceof SyntaxError ? '设置格式无效。' : '设置暂时无法保存，请重试。' }, { status: error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503 });
  }
}
export const GET = (request: NextRequest) => handle(request, false);
export const PUT = (request: NextRequest) => handle(request, true);
