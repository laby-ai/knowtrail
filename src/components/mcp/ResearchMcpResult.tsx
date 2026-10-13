'use client';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
function object(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function parsed(value: unknown): unknown { if (typeof value !== 'string') return value; try { return JSON.parse(value); } catch { return value; } }
export function mcpValue(raw: unknown): Record<string, unknown> {
  const shell = object(raw) || {}; const content = object(shell.structuredContent); if (content) return content;
  if (Array.isArray(shell.content)) { const text = shell.content.map(item => object(item)?.text).filter(value => typeof value === 'string').join('\n'); return object(parsed(text)) || { text }; }
  return shell;
}
export function mcpFailure(raw: unknown): string | undefined {
  const shell = object(raw); const value = mcpValue(raw);
  if (shell?.isError === true || value.ok === false || value.dry_run === true) return typeof value.message === 'string' ? value.message : typeof value.error === 'string' ? value.error : '工具未完成，请检查输入或上游服务状态。';
  const body = object(value.data) || value; const nested = object(parsed(body.result)) || body;
  if (typeof nested.error === 'string') return nested.error;
}
function paperLink(paper: Record<string, unknown>): string | undefined {
  if (typeof paper.url === 'string' && /^https:\/\//.test(paper.url)) return paper.url;
  if (typeof paper.doi === 'string' && /^10\.\d{4,9}\//.test(paper.doi)) return `https://doi.org/${paper.doi}`;
  const id = typeof paper.arxiv_id === 'string' ? paper.arxiv_id : typeof paper.pdf_url === 'string' ? paper.pdf_url.match(/\/pdf\/(\d{4}\.\d{4,5}(?:v\d+)?)/)?.[1] : undefined;
  return id && /^\d{4}\.\d{4,5}(?:v\d+)?$/.test(id) ? `https://arxiv.org/abs/${id}` : undefined;
}
function download(name: string, content: string, binary: boolean) {
  const payload = binary ? Uint8Array.from(atob(content), character => character.charCodeAt(0)) : content;
  const url = URL.createObjectURL(new Blob([payload])); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name.replace(/[^A-Za-z0-9._-]/g, '_'); anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ResearchMcpResult({ raw }: { raw: unknown }) {
  const value = mcpValue(raw); const body = object(value.data) || value;
  const nested = parsed(body.result ?? body.stdout ?? body.text); const display = object(nested) || body;
  const papers = display.results || display.papers || display.normalized_results || display.candidates;
  const report = typeof body.file_name === 'string' && typeof body.content === 'string' ? { name: body.file_name, content: body.content, binary: body.encoding === 'base64' } : undefined;
  const rawShell = object(raw);
  return <div className="space-y-4 break-words text-sm leading-7" data-testid="research-mcp-result">
    {value.source_format === 'pdf-text-layer' && <p className="rounded-xl border border-[var(--border-subtle)] p-3">本次抽取基于 PDF 文本层，原始页码请回论文文件复核；扫描件需先完成 OCR。</p>}
    {rawShell?.claimSupport === 'not-verified' && <p className="rounded-xl border border-amber-300/30 bg-amber-500/5 p-3">这里核对的是候选题录。题名匹配不能证明正文主张成立，仍需全文证据核验。</p>}
    {Array.isArray(papers) ? <div className="space-y-3">{papers.length === 0 && <p className="rounded-xl border border-[var(--border-subtle)] p-4">{rawShell?.claimSupport === 'not-verified' ? '本次未获得可用的引用候选，不能据此判断正文主张是否成立。请检查检索状态、调整关键词或稍后重试。' : '本次未返回匹配文献，请调整检索词或筛选条件。'}</p>}{papers.map((paper, index) => {
      const row = object(paper) || {}; const link = paperLink(row);
      const abstract = typeof row.abstract_snippet === 'string' ? row.abstract_snippet : typeof row.abstract === 'string' ? row.abstract : undefined;
      return <article key={typeof row.id === 'string' ? row.id : index} className="rounded-xl border border-[var(--border-subtle)] p-4"><h4 className="font-semibold">{typeof row.title === 'string' ? row.title.replace(/&lt;[^&]*&gt;|<[^>]+>/g, '') : '未返回题名'}</h4><p className="mt-2 text-[var(--text-secondary)]">{Array.isArray(row.authors) ? row.authors.filter(item => typeof item === 'string').slice(0, 4).join('、') : typeof row.authors === 'string' ? row.authors : '作者未返回'}{typeof row.year === 'string' || typeof row.year === 'number' ? ` · ${row.year}` : ''}</p>{typeof row.id === 'string' && <p className="mt-1 text-xs text-[var(--text-secondary)]">文献编号：<code>{row.id}</code></p>}{abstract && <p className="mt-2">{abstract.replace(/<[^>]+>/g, '')}</p>}{link && <a href={link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-blue-500 underline underline-offset-4">打开来源</a>}</article>;
    })}</div>
      : report ? <div>{report.binary && report.name.endsWith('.png') ? <Image src={`data:image/png;base64,${report.content}`} width={900} height={700} unoptimized alt="PRISMA 流程图" className="h-auto max-w-full rounded-lg" /> : <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--bg-secondary)] p-4 font-sans text-sm leading-7">{report.content}</pre>}<button type="button" className="liquid-glass-btn mt-3 px-4 py-2" onClick={() => download(report.name, report.content, report.binary)}>下载 {report.name}</button></div>
      : typeof nested === 'string' ? <div className="prose prose-sm max-w-none text-[var(--text-primary)]"><ReactMarkdown>{nested}</ReactMarkdown></div>
      : <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--bg-secondary)] p-4 text-xs leading-6">{JSON.stringify(display, null, 2)}</pre>}
    {rawShell?.evidence !== undefined && <details className="rounded-xl border border-[var(--border-subtle)] p-3"><summary className="cursor-pointer font-medium">查看已抽取的引文与参考文献证据</summary><ResearchMcpResult raw={rawShell.evidence} /></details>}
  </div>;
}
