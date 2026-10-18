import { NextRequest, NextResponse } from 'next/server';
import { resolveFileUrl, isProduction } from '@/lib/storage';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { listIngestionSources } from '@/lib/ingestion-store';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

/**
 * 文件访问路由
 * GET /api/file?key=<s3_key_or_local_path>
 *
 * 仅解析已核验归属的上传文件；本地文件仍由私有上传路径核验读取。
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fileKey = searchParams.get('key');
    const scope = await resolveAccountNotebookScope(request, {
      notebookId: searchParams.get('notebookId'),
      loginMessage: '请先登录国科大科教平台，再读取文件。',
    });
    if (!scope.ok) return scope.response;

    if (!fileKey) {
      return NextResponse.json({ error: '缺少 key 参数' }, { status: 400, headers: privateHeaders });
    }
    const sources = await listIngestionSources({ ownerMemberId: scope.ownerMemberId, notebookId: scope.notebookId });
    if (!/^\/?uploads\/(?!\.{1,2}$)[^/\\\u0000-\u001f]+$/.test(fileKey) || !sources.some(source => (source.storageKey || source.fileUrl) === fileKey)) {
      return NextResponse.json({ error: '文件不存在或无权访问。' }, { status: 404, headers: privateHeaders });
    }

    if (!isProduction()) {
      // 开发环境：文件通过 Next.js 静态服务直接访问，无需重定向
      return NextResponse.json({ url: fileKey }, { headers: privateHeaders });
    }

    // 生产环境：生成签名 URL
    const signedUrl = await resolveFileUrl(fileKey);
    const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/+$/, '');
    const target = signedUrl.startsWith('/uploads/') ? `${basePath}/uploads/${encodeURIComponent(signedUrl.slice('/uploads/'.length))}` : signedUrl;
    return NextResponse.redirect(new URL(target, request.url), { headers: privateHeaders });
  } catch (error) {
    console.error('[File API Error]', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '文件访问失败' }, { status: 503, headers: privateHeaders });
  }
}
