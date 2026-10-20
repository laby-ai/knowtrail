import { readFile } from 'node:fs/promises';
import path from 'node:path';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const releaseId = (await readFile(path.join(process.cwd(), '.next/BUILD_ID'), 'utf8')).trim();
    if (!/^[\w-]{1,128}$/.test(releaseId)) throw new Error('invalid_release');
    return Response.json({ releaseId }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: '发布信息暂时不可用。' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
