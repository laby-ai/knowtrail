import type { NextRequest } from 'next/server';
import { resolveAccountSessionFromRequest } from '@/lib/account-session';
import { parseResearchPreferences } from '@/lib/research-preferences';
import { readResearchPreferences, saveResearchPreferences } from '@/lib/research-preferences-store';

async function handle(request: NextRequest, write: boolean) {
  let owner: string;
  try {
    const session = await resolveAccountSessionFromRequest(request);
    if (!session) return Response.json({ error: '请登录后设置研究领域。' }, { status: 401 });
    owner = session.member.id;
  } catch { return Response.json({ error: '登录已失效，请重新登录。' }, { status: 401 }); }
  try {
    if (!write) return Response.json(await readResearchPreferences(owner), { headers: { 'Cache-Control': 'no-store' } });
    let preferences;
    try {
      preferences = parseResearchPreferences(await request.json());
      if (!preferences.disciplines.length) throw new Error('请至少选择一个研究领域。');
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : '科研偏好不正确。' }, { status: 400 }); }
    return Response.json(await saveResearchPreferences(owner, preferences), { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: '科研偏好暂时无法保存或读取，请重试。' }, { status: 503 }); }
}
export const GET = (request: NextRequest) => handle(request, false);
export const PUT = (request: NextRequest) => handle(request, true);
