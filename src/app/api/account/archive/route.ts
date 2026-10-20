import type { NextRequest } from 'next/server';
import { resolveAccountSessionFromRequest } from '@/lib/account-session';
import { listNotebooks } from '@/lib/notebook-store';
import { readResearchWorkspace } from '@/lib/research-workspace-store';
import { readAppPreferences } from '@/lib/app-preferences-store';

export async function GET(request: NextRequest) {
  const session = await resolveAccountSessionFromRequest(request).catch(() => null);
  if (!session) return Response.json({ error: '请重新登录。' }, { status: 401 });
  try {
    const notebooks = await listNotebooks(session.member.id);
    const entries = [];
    let size = 0;
    for (const notebook of notebooks) {
      const workspace = await readResearchWorkspace({ tenantId: session.tenant_id, memberId: session.member.id, notebookId: notebook.id });
      const entry = { id: notebook.id, title: notebook.title, messages: workspace.messages, artifacts: workspace.artifacts };
      size += Buffer.byteLength(JSON.stringify(entry));
      if (size > 32 * 1024 * 1024) return Response.json({ error: '历史记录超过单次下载上限，请在文献本中分别导出。' }, { status: 413 });
      entries.push(entry);
    }
    return Response.json({ format: 'lingbi-research-archive', version: 1, exportedAt: new Date().toISOString(), memberId: session.member.id, preferences: await readAppPreferences(session.member.id), notebooks: entries }, { headers: { 'Cache-Control': 'private, no-store', 'Content-Disposition': 'attachment; filename="lingbi-research-history.json"' } });
  } catch { return Response.json({ error: '历史记录下载失败，请稍后重试。' }, { status: 503 }); }
}
