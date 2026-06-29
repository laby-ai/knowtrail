import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';

const HTML_DIR = path.join(process.cwd(), 'output', 'virtual-classroom', 'html');

function safePreviewId(value: string): string | null {
  const trimmed = value.trim();
  return /^[a-zA-Z0-9_-]{8,80}$/.test(trimmed) ? trimmed : null;
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const safeId = safePreviewId(id);
  if (!safeId) {
    return new Response('Invalid classroom id', { status: 400 });
  }

  try {
    const html = await readFile(path.join(HTML_DIR, `${safeId}.html`), 'utf8');
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return new Response('课堂预览不存在', { status: 404 });
  }
}
