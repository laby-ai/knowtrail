import type { NextRequest } from 'next/server';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { readScientificIllustration } from '@/lib/scientific-illustration-store';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const accountScope = await resolveAccountNotebookScope(request, {
    loginMessage: '请先登录后再查看科研示意图。',
    requireAuthenticatedPaperHost: true,
  });
  if (!accountScope.ok) return accountScope.response;

  try {
    const { id } = await context.params;
    const stored = await readScientificIllustration(id, accountScope.ownerMemberId);
    const download = request.nextUrl.searchParams.get('download') === '1';
    const disposition = download ? 'attachment' : 'inline';
    return new Response(new Uint8Array(stored.image), {
      headers: {
        'Content-Type': stored.metadata.mimeType,
        'Content-Length': String(stored.image.length),
        'Content-Disposition': `${disposition}; filename="scientific-illustration-${stored.metadata.id}.${stored.metadata.extension}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '科研示意图不存在。';
    const forbidden = message.includes('无权访问');
    return Response.json(
      { code: forbidden ? 403 : 404, msg: message, error: message, status: 'failed', errorType: forbidden ? 'scientific_illustration_forbidden' : 'scientific_illustration_not_found' },
      { status: forbidden ? 403 : 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
