import { NextRequest, NextResponse } from 'next/server';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';

export const maxDuration = 60;

// Fetch a discovered web page server-side and reduce it to readable text so
// the client can ingest it as a source through the normal upload pipeline.

const MAX_HTML_BYTES = 3_000_000;
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

  try {
    const response = await fetch(parsed.toString(), {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KnowTrailBot/1.0; +https://airai.world)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
      },
      signal: AbortSignal.timeout(Number(process.env.DISCOVER_FETCH_TIMEOUT_MS || 20_000)),
    });
    if (!response.ok) {
      return NextResponse.json({ error: `网页返回 HTTP ${response.status}` }, { status: 502 });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
      return NextResponse.json({ error: `暂不支持的内容类型:${contentType.split(';')[0] || '未知'}` }, { status: 415 });
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_HTML_BYTES) {
      return NextResponse.json({ error: '网页过大,无法抓取' }, { status: 413 });
    }
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
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    return NextResponse.json({ error: timedOut ? '抓取超时' : '网页抓取失败' }, { status: 502 });
  }
}
