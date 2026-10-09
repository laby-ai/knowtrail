'use client';

import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useApp } from '@/contexts/AppContext';
import type { Citation } from '@/types';

function EvidenceMarker({ number, citation }: { number: number; citation?: Citation }) {
  const { revealPaper } = useApp();
  const [open, setOpen] = useState(false);
  if (!citation) return <sup className="text-amber-700" title="没有对应来源，需补充证据">[{number} 待核验]</sup>;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button type="button" onMouseEnter={() => setOpen(true)} onFocus={() => setOpen(true)} aria-label={`查看证据 ${number}`} className="mx-0.5 align-super text-[10px] font-semibold text-[var(--accent-blue)]">[{number}]</button></PopoverTrigger>
    <PopoverContent className="z-[100] max-h-80 w-80 overflow-y-auto text-xs" onMouseLeave={() => setOpen(false)}>
      <h4 className="font-semibold">{citation.sourceTitle || citation.paperShortName || '来源片段'}</h4>
      <p className="mt-2 text-[var(--text-tertiary)]">{citation.page ? `第 ${citation.page} 页 · ` : ''}{typeof citation.chunkIndex === 'number' ? `片段 ${citation.chunkIndex + 1}` : '未提供原文位置'}</p>
      <blockquote className="mt-2 whitespace-pre-wrap border-l-2 pl-2 leading-relaxed">{citation.excerpt || citation.snippet || '没有可展示的原文片段，请打开来源核验。'}</blockquote>
      {(citation.paperId || citation.sourceId) && <button type="button" className="liquid-glass-btn mt-3 px-3 py-2" onClick={() => { revealPaper(citation.paperId || citation.sourceId!, citation); setOpen(false); }}>定位文献原文</button>}
    </PopoverContent>
  </Popover>;
}

export function EvidenceText({ text, markers = [], citations }: { text: string; markers?: number[]; citations: Citation[] }) {
  const parts = text.split(/(\[\d+\])/g);
  const present = new Set(parts.filter(value => /^\[\d+\]$/.test(value)).map(value => Number(value.slice(1, -1))));
  return <>{parts.map((part, index) => /^\[\d+\]$/.test(part) ? <EvidenceMarker key={index} number={Number(part.slice(1, -1))} citation={citations[Number(part.slice(1, -1)) - 1]} /> : part)}{markers.filter(number => !present.has(number)).map(number => <EvidenceMarker key={`extra-${number}`} number={number} citation={citations[number - 1]} />)}</>;
}
