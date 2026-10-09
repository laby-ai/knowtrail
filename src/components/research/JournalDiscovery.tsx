'use client';
import { useState } from 'react';
import { clientApiRequest } from '@/lib/client-api';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import type { JournalCandidate } from '@/lib/journal-discovery';
export function JournalDiscovery({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery), [items, setItems] = useState<JournalCandidate[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [searched, setSearched] = useState(false);
  async function search() {
    setBusy(true); setError(''); setSearched(false); setItems([]);
    try {
      const response = await clientApiRequest(`/api/research/journals?query=${encodeURIComponent(query.trim())}`, { headers: accountAuthHeaders() });
      const data = await response.json() as { error?: string; candidates?: JournalCandidate[] };
      if (!response.ok) throw new Error(data.error || '期刊检索失败');
      setItems(data.candidates || []); setSearched(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '期刊检索失败，请重试。'); } finally { setBusy(false); }
  }
  return <details className="rounded-lg border p-3 text-xs" data-testid="journal-discovery"><summary className="cursor-pointer font-semibold">相关期刊与官方模板</summary><div className="mt-3 space-y-3">
    <p className="leading-relaxed text-[var(--text-tertiary)]">按主题检索 Crossref 前 40 条论文，列出真实刊载期刊与 DOI。样本命中数用于查看检索分布，不代表选刊得分；请核对期刊范围、费用和最新投稿要求。</p>
    <label className="block">研究主题或关键词<input className="liquid-glass-input mt-1 w-full" value={query} onChange={event => setQuery(event.target.value)} maxLength={500} /></label>
    <button type="button" disabled={busy || query.trim().length < 3} onClick={() => void search()} className="liquid-glass-btn px-3 py-2">{busy ? '正在检索真实元数据…' : '检索相关期刊'}</button>
    {error && <p role="alert" className="text-red-600">{error}</p>}{searched && !items.length && <p>未找到可用的期刊元数据，请调整关键词。</p>}
    {items.map(item => <article key={item.title} className="rounded-lg border p-3"><h4 className="font-semibold">{item.title}</h4><p className="mt-1 text-[var(--text-tertiary)]">{item.publisher} · ISSN {item.issn.join(' / ') || '未提供'} · 样本命中 {item.matchedWorks.length}</p><ul className="mt-2 space-y-1">{item.matchedWorks.slice(0, 3).map(work => <li key={work.doi}><a href={`https://doi.org/${encodeURIComponent(work.doi)}`} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-blue)]">{work.title}</a></li>)}</ul></article>)}
    <div className="border-t pt-3"><p className="mb-2 font-semibold">官方模板入口</p><a className="text-[var(--accent-blue)]" href="https://template-selector.ieee.org/" target="_blank" rel="noopener noreferrer">IEEE 官方 Word / LaTeX 模板选择器</a><p className="mt-1 text-[var(--text-tertiary)]">官方模板需按具体刊物选择；通用导出未适配 IEEE 官方格式。</p></div>
  </div></details>;
}
