import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { fetchFullText, fetchFullTextFromUrl, fetchLiteratureFullText, FullTextError } from '@/lib/literature/fulltext';
import { MAX_LITERATURE_RESULT_TOKEN_LENGTH, verifyLiteratureResult } from '@/lib/literature/result-token';

const fulltextSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('doi'), doi: z.string().min(1).max(2048) }),
  z.object({ type: z.literal('url'), pdfUrl: z.string().url().max(8192) }),
  z.object({ type: z.literal('resultId'), resultId: z.string().min(1).max(MAX_LITERATURE_RESULT_TOKEN_LENGTH) }),
]);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = fulltextSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '参数错误', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const input = parsed.data;
    let doi: string | undefined;
    let pdfUrl: string | undefined;

    if (input.type === 'doi') {
      doi = input.doi;
    } else if (input.type === 'url') {
      pdfUrl = input.pdfUrl;
    } else if (input.type === 'resultId') {
      const payload = verifyLiteratureResult(input.resultId);
      if (!payload) {
        return NextResponse.json({ error: '无效的文献令牌' }, { status: 401 });
      }
      const result = await fetchLiteratureFullText(payload);
      return NextResponse.json({ success: true, ...result });
    }

    if (pdfUrl) {
      const fullText = await fetchFullTextFromUrl(pdfUrl);
      return NextResponse.json({
        success: true,
        fullText,
        pdfUrl,
        source: 'direct',
        charCount: fullText.length,
      });
    }

    if (doi) {
      const result = await fetchFullText(doi);
      return NextResponse.json({
        success: true,
        ...result,
      });
    }

    return NextResponse.json(
      { error: 'no_oa', message: '该论文暂无开放获取全文' },
      { status: 404 }
    );
  } catch (err) {
    if (err instanceof FullTextError) {
      const status = {
        no_oa: 404,
        no_identifier: 404,
        network_error: 502,
        extraction_failed: 422,
        unsafe_url: 400,
        too_large: 413,
      }[err.code];
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status }
      );
    }

    const message = err instanceof Error ? err.message : '全文获取失败';
    console.error('[Literature Fulltext]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
