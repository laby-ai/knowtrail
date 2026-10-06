import { NextRequest, NextResponse } from 'next/server';
import { accountAuthRequired, resolveAccountSessionFromRequest } from '@/lib/account-session';
import { listNotebooks, saveNotebookMetadata } from '@/lib/notebook-store';
import { normalizeNotebookId } from '@/lib/notebook-scope';
async function handle(request: NextRequest, write: boolean) {
  let owner: string | undefined;
  try { const session = await resolveAccountSessionFromRequest(request); if (!session && accountAuthRequired()) return NextResponse.json({ error: '请登录后读取文献本。' }, { status: 401 }); owner = session?.member.id; }
  catch { return NextResponse.json({ error: '登录已失效，请重新登录。' }, { status: 401 }); }
  try {
    if (write) {
      const body = await request.json().catch(() => null);
      if (!body || !Array.isArray(body.notebooks) || body.notebooks.length > 500 || !body.notebooks.every((item: {id?: unknown; title?: unknown} | null) => item && normalizeNotebookId(item.id) === item.id && typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 80)) return NextResponse.json({ error: '文献本名称或编号无效。' }, { status: 400 });
      await saveNotebookMetadata(owner, body.notebooks, body.onlyMissing === true);
    }
    return NextResponse.json({ notebooks: await listNotebooks(owner) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: '无法同步文献本，请稍后重试。' }, { status: 500 }); }
}
export const GET = (request: NextRequest) => handle(request, false);
export const POST = (request: NextRequest) => handle(request, true);