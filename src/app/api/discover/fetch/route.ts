import { NextRequest, NextResponse } from 'next/server';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { fetchPublicSource, PublicSourceError } from '@/lib/public-source-fetch';

export const maxDuration = 60;

// Fetch a discovered web page server-side and reduce it to readable text so
// the client can ingest it as a source through the normal upload pipeline.

const MAX_TEXT_CHARS = 60_000;

function htmlToReadableText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() : '';

  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  // Prefer main/article content when present.
  const mainMatch = body.match(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/i);
  if (mainMatch && mainMatch[2].length > 500) body = mainMatch[2];

  const text = decodeEntities(
    body
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote|pre)>/gi, '\n')
      .replace(/<(br|hr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title, text: text.slice(0, MAX_TEXT_CHARS) };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const num = Number(code);
      return Number.isFinite(num) && num > 0 && num < 0x10ffff ? String.fromCodePoint(num) : '';
    });
}

export async function POST(request: NextRequest) {
  const body = await request.json() as { url?: string; notebookId?: string };
  const scope = await resolveAccountNotebookScope(request, {
    notebookId: body.notebookId,
    loginMessage: '请先登录账号,再添加网络信源。',
  });
  if (!scope.ok) return scope.response;

  const rawUrl = (body.url || '').trim();
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: '链接格式无效' }, { status: 400 });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return NextResponse.json({ error: '仅支持 http/https 链接' }, { status: 400 });
  }

  let signal: AbortSignal | undefined;
  try {
    signal = AbortSignal.any([request.signal, AbortSignal.timeout(Number(process.env.DISCOVER_FETCH_TIMEOUT_MS || 20_000))]);
    const { buffer, contentType } = await fetchPublicSource(parsed, signal);
    const html = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    const { title, text } = contentType.includes('text/plain')
      ? { title: '', text: html.slice(0, MAX_TEXT_CHARS) }
      : htmlToReadableText(html);

    if (text.length < 80) {
      return NextResponse.json({ error: '未能提取到有效正文(网页可能需要登录或由脚本渲染)' }, { status: 422 });
    }

    console.log(`[Discover] fetched ${parsed.hostname} -> ${text.length} chars`);
    return NextResponse.json({ success: true, title, text, url: parsed.toString() });
  } catch (err) {
    if (err instanceof PublicSourceError) return NextResponse.json({ error: err.message }, { status: err.status });
    const timedOut = signal?.reason instanceof Error && signal.reason.name === 'TimeoutError';
    return NextResponse.json({ error: timedOut ? '抓取超时' : '网页抓取失败' }, { status: 502 });
  }
}
