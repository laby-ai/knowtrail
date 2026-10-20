'use client';

import React, { useMemo, useRef, useState } from 'react';

export function sourceTextPages(text: string): string[] {
  const pages: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 6000, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    pages.push(text.slice(start, end));
    start = end;
  }
  return pages;
}

interface SourceTextReaderProps {
  rawContent?: string;
  chunks?: Array<{ text?: string }>;
}

/** Owns only the text view position; source identity and requests remain in LibraryPanel. */
export function SourceTextReader({ rawContent, chunks }: SourceTextReaderProps) {
  const hasOriginal = Boolean(rawContent?.trim());
  const text = rawContent?.trim() ? rawContent : (chunks || []).map(chunk => chunk.text || '').filter(Boolean).join('\n\n');
  const pages = useMemo(() => sourceTextPages(text), [text]);
  const [page, setPage] = useState(0);
  const root = useRef<HTMLElement>(null);
  if (pages.length === 0) return null;

  const turn = (next: number) => {
    setPage(next);
    root.current?.scrollIntoView({ block: 'start' });
  };

  return (
    <section ref={root} data-testid="source-text-reader" className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--glass-subtle)] p-3">
      <div className="sticky top-0 z-10 space-y-2 rounded-lg bg-[var(--bg-primary)] py-2">
        <h4 className="text-sm font-semibold text-[var(--text-primary)]">{hasOriginal ? '提取正文' : '已保存片段'}</h4>
        <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          {hasOriginal
            ? '可翻页阅读全部已保存的提取文本；文本页不对应原文件页码，未提取的图表和扫描内容不会补出。'
            : '此来源未独立保存原文，以下显示全部入库片段，可能含摘要或重复内容。'}
        </p>
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="liquid-glass-btn shrink-0 whitespace-nowrap px-2 py-2 text-xs disabled:cursor-default disabled:opacity-40" data-testid="source-text-previous" disabled={page === 0} onClick={() => turn(page - 1)}>上一页</button>
          <span data-testid="source-text-position" className="whitespace-nowrap text-xs text-[var(--text-secondary)]">文本 {page + 1} / {pages.length}</span>
          <button type="button" className="liquid-glass-btn shrink-0 whitespace-nowrap px-2 py-2 text-xs disabled:cursor-default disabled:opacity-40" data-testid="source-text-next" disabled={page === pages.length - 1} onClick={() => turn(page + 1)}>下一页</button>
        </div>
      </div>
      <p data-testid="source-text-body" className="whitespace-pre-wrap break-words text-sm leading-7 text-[var(--text-primary)]">{pages[page]}</p>
    </section>
  );
}
