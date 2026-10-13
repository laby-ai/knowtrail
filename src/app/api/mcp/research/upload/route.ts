import { NextRequest, NextResponse } from 'next/server';
import { resolveAccountSessionFromRequest } from '@/lib/account-session';
import { authorizeResearchNotebook, uploadCitationFile, ResearchMcpError } from '@/lib/mcp/research-client';
import { readResearchBody } from '@/lib/mcp/research-request';
export async function POST(request: NextRequest) {
  try {
    const session = await resolveAccountSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: '请登录后上传核验论文。' }, { status: 401 });
    const length = Number(request.headers.get('content-length'));
    if (Number.isFinite(length) && length > 7 * 1024 * 1024) return NextResponse.json({ error: '上传文件过大。' }, { status: 413 });
    const bytes = await readResearchBody(request, 7 * 1024 * 1024);
    const form = await new Response(bytes.buffer, { headers: { 'Content-Type': request.headers.get('Content-Type') || '' } }).formData();
    const file = form.get('file'); const notebook = form.get('notebookId');
    if (!(file instanceof File) || typeof notebook !== 'string' || notebook.length > 200) return NextResponse.json({ error: '请选择文件和文献本。' }, { status: 400 });
    const scope = await authorizeResearchNotebook(session, notebook);
    return NextResponse.json(await uploadCitationFile(scope, file), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return NextResponse.json({ error: error instanceof ResearchMcpError ? error.message : '论文上传失败。' }, { status: error instanceof ResearchMcpError ? error.status : 502 }); }
}
