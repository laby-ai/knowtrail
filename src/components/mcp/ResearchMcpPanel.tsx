'use client';
import { useEffect, useRef, useState } from 'react';
import { PlugZap, Loader2, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useApp } from '@/contexts/AppContext';
import { clientApiRequest } from '@/lib/client-api';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import { MCP_TOOL_LABELS, type ResearchMcpConnection, type ResearchMcpId } from '@/lib/mcp/research-contracts';
import { defaultMcpFields, mcpArguments, ResearchMcpFields } from './ResearchMcpFields';
import { mcpFailure, ResearchMcpResult } from './ResearchMcpResult';

const DEFAULT_TOOLS: Record<ResearchMcpId, string> = { labmate: 'calculate_molarity', pubcrawl: 'search_europepmc', prisma: 'configure_project', giiisp: 'search_papers', papercheck: 'extract_citation_evidence' };
export function ResearchMcpPanel() {
  const { storageScopeKey } = useApp();
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);
  const [open, setOpen] = useState(false);
  const [connections, setConnections] = useState<ResearchMcpConnection[]>([]);
  const [selected, setSelected] = useState<ResearchMcpId>('labmate');
  const [toolName, setToolName] = useState('calculate_molarity');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<unknown>();
  const [uploaded, setUploaded] = useState('');
  const controller = useRef<AbortController | null>(null);
  const connection = connections.find(item => item.id === selected);
  const tool = connection?.tools.find(item => item.name === toolName);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController(); setLoading(true); setError('');
    clientApiRequest('/api/mcp/research', { signal: abort.signal }).then(response => response.json()).then((data: { connections: ResearchMcpConnection[] }) => {
      if (abort.signal.aborted) return;
      setConnections(data.connections);
      const current = data.connections.find(item => item.id === selected)?.tools.find(item => item.name === toolName);
      if (current) setFields(previous => Object.keys(previous).length ? previous : defaultMcpFields(current));
    }).catch((failure: unknown) => { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : '连接状态读取失败。'); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [open, selected, toolName]);
  const selectTool = (name: string, id = selected) => {
    const next = connections.find(item => item.id === id)?.tools.find(item => item.name === name);
    setSelected(id); setToolName(name); setError(''); setResult(undefined);
    setFields(next ? { ...defaultMcpFields(next), ...(id === 'papercheck' && name === 'extract_citation_evidence' && uploaded ? { workspace_file: uploaded } : {}) } : {});
  };
  const run = async () => {
    if (!tool || !notebookId) return;
    const abort = new AbortController(); controller.current = abort; setBusy(true); setError(''); setResult(undefined);
    try {
      const response = await clientApiRequest('/api/mcp/research/call', { method: 'POST', timeoutMs: 110_000, redirectOnUnauthorized: false, signal: abort.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mcpId: selected, notebookId, toolName, arguments: mcpArguments(tool, fields) }) });
      const data: { result: unknown } = await response.json(); setResult(data.result); setError(mcpFailure(data.result) || '');
    } catch (failure) { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : '科研任务执行失败。'); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  };
  const upload = async (file: File) => {
    if (!notebookId) return;
    const abort = new AbortController(); controller.current = abort; setBusy(true); setError('');
    try {
      const form = new FormData(); form.set('file', file); form.set('notebookId', notebookId);
      const response = await clientApiRequest('/api/mcp/research/upload', { method: 'POST', body: form, timeoutMs: 110_000, redirectOnUnauthorized: false, signal: abort.signal });
      const data: { path: string } = await response.json(); setUploaded(data.path); setFields(previous => ({ ...previous, workspace_file: data.path }));
    } catch (failure) { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : '论文上传失败。'); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  };
  return <>
    <button type="button" onClick={() => setOpen(true)} className="liquid-glass-btn mt-3 inline-flex w-full items-center justify-between gap-2 rounded-xl px-3 py-3 text-xs" data-testid="research-mcp-open"><span className="inline-flex items-center gap-2"><PlugZap className="h-4 w-4" />科研 MCP</span><span className="text-[var(--text-tertiary)]">检索、实验与引用核验</span></button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="flex max-h-[90dvh] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
      <DialogHeader className="shrink-0 border-b border-[var(--border-subtle)] px-5 py-4 pr-12"><DialogTitle>科研 MCP</DialogTitle><DialogDescription>连接真实科研服务，在当前文献本中执行检索、计算、筛选和引用核验。</DialogDescription></DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {loading && <p className="mb-4 text-sm text-[var(--text-secondary)]">正在读取服务连接状态…</p>}
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-5">{connections.map(item => <button key={item.id} disabled={busy} type="button" onClick={() => selectTool(DEFAULT_TOOLS[item.id], item.id)} aria-pressed={selected === item.id} data-testid={`research-mcp-${item.id}`} className={`rounded-xl border p-3 text-left text-sm ${selected === item.id ? 'border-blue-400 bg-blue-500/5' : 'border-[var(--border-subtle)]'}`}><span className="block font-medium">{item.name}</span><span className="mt-1 block text-xs text-[var(--text-tertiary)]">{item.available ? item.verified ? '已连接 · 实测通过' : '已连接 · 待实测' : '暂不可用'}</span></button>)}</div>
        {connection && <p className="mb-4 text-sm leading-6 text-[var(--text-secondary)]">{connection.description}{!connection.available && `：${connection.message}`}</p>}
        {tool && <form onSubmit={event => { event.preventDefault(); void run(); }} className="space-y-4">
          <fieldset disabled={busy || !connection?.available} className="space-y-4"><label className="block space-y-2 text-sm"><span className="font-medium">选择功能</span><select value={toolName} onChange={event => selectTool(event.target.value)} className="liquid-glass-input min-h-11 w-full rounded-lg px-3">{connection?.tools.map(item => <option key={item.name} value={item.name}>{MCP_TOOL_LABELS[item.name] || item.description}</option>)}</select></label>
            {selected === 'prisma' && <p className="rounded-xl bg-[var(--bg-secondary)] p-3 text-sm leading-6">先配置综述，再启动检索与关键词初筛；初筛结果仍需人工复核。使用“查看流程进度”检查任务，“生成流程图与报告”后可读取导出成果。</p>}
            {selected === 'labmate' && toolName === 'calculate_molarity' && <p className="text-sm text-[var(--text-secondary)]">填写已知量，未知量留空。例如填写物质的量与体积可计算摩尔浓度。</p>}
            {selected === 'papercheck' && toolName === 'extract_citation_evidence' && <label className="block space-y-2 text-sm"><span className="font-medium">上传待核验论文（PDF、DOCX、TXT，最大 6MB）</span><input type="file" accept=".pdf,.docx,.txt,.md" className="block max-w-full" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} /><span className="block text-xs text-[var(--text-tertiary)]">每个文献本的核验工作区最多 50MB、30 个文件。</span>{uploaded && <span className="block text-xs text-emerald-600">论文已上传，可执行证据抽取。</span>}</label>}
            <ResearchMcpFields tool={tool} fields={fields} onChange={(key, value) => setFields(previous => ({ ...previous, [key]: value }))} />
            <button type="submit" disabled={!notebookId} className="liquid-glass-btn-primary inline-flex min-h-11 items-center gap-2 rounded-lg px-5 py-2 text-sm">{busy ? <><Loader2 className="h-4 w-4 animate-spin" />正在执行…</> : '执行所选功能'}</button>
          </fieldset>
        </form>}
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-400/30 bg-red-500/5 p-3 text-sm leading-6 text-red-600">{error}</p>}
        {result !== undefined && <section className="mt-6 border-t border-[var(--border-subtle)] pt-5"><h3 className="mb-3 font-semibold">执行结果</h3><ResearchMcpResult raw={result} /></section>}
        {selected === 'prisma' && connection?.available && <div className="mt-4 flex flex-wrap gap-2">{['get_pipeline_progress', 'get_papers_to_screen', 'generate_report', 'read_report'].map(name => <button key={name} type="button" disabled={busy} className="liquid-glass-btn inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs" onClick={() => selectTool(name)}><RefreshCw className="h-3 w-3" />{MCP_TOOL_LABELS[name]}</button>)}</div>}
      </div>
    </DialogContent></Dialog>
  </>;
}
