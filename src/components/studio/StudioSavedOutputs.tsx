'use client';

import { useEffect, useState } from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { clientApiRequest } from '@/lib/client-api';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import { STUDIO_OUTPUT_SAVED } from '@/lib/studio-output-events';
import { describeStudioOutput, STUDIO_OUTPUT_SOURCES, studioOutputUrl, type StudioOutputKind, type StudioSavedOutput } from '@/lib/studio-saved-outputs';
import { STUDIO_NAV } from './StudioToolSwitcher';

export function StudioSavedOutputs({ onOpen }: { onOpen: (output: StudioSavedOutput) => void }) {
  const { storageScopeKey, chatMessages } = useApp();
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);
  const guest = storageScopeKey.startsWith('guest:');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ scope: string; rows: Partial<Record<StudioOutputKind, StudioSavedOutput | null>>; errors: Partial<Record<StudioOutputKind, string>>; loading: boolean }>({ scope: '', rows: {}, errors: {}, loading: true });
  const references = chatMessages.flatMap(message => (message.toolCalls || []).map(call => call.report?.revision || call.knowledgeMap?.revision || call.dataPlan?.revision || call.learning?.revision || call.illustration?.revision || call.presentation?.artifact?.id || '')).filter(Boolean).join(':');

  useEffect(() => {
    const controller = new AbortController();
    const requestIds = new Map<StudioOutputKind, number>();
    setState({ scope: storageScopeKey, rows: {}, errors: {}, loading: !guest && Boolean(notebookId) });
    if (guest || !notebookId) return () => controller.abort();
    const load = async (sources: readonly typeof STUDIO_OUTPUT_SOURCES[number][]) => {
      await Promise.all(sources.map(async source => {
        const id = (requestIds.get(source.kind) || 0) + 1;
        requestIds.set(source.kind, id);
        let row: StudioSavedOutput | null = null;
        let error: string | undefined;
        try {
          const response = await clientApiRequest(studioOutputUrl(source.kind, notebookId), { headers: accountAuthHeaders(), signal: controller.signal, redirectOnUnauthorized: false, cache: 'no-store' });
          if (response.status !== 404) {
            if (!response.ok) throw new Error(`${source.label}暂时无法读取`);
            row = describeStudioOutput(source.kind, await response.json());
          }
        } catch (caught) { error = caught instanceof Error ? caught.message : `${source.label}读取失败`; }
        if (controller.signal.aborted || requestIds.get(source.kind) !== id) return;
        setState(previous => ({ ...previous, rows: { ...previous.rows, [source.kind]: row }, errors: { ...previous.errors, [source.kind]: error } }));
      }));
    };
    void load(STUDIO_OUTPUT_SOURCES).finally(() => { if (!controller.signal.aborted) setState(previous => ({ ...previous, loading: false })); });
    const saved = (event: Event) => {
      const detail = (event as CustomEvent<{ scopeKey?: string; toolId?: string }>).detail;
      if (detail?.scopeKey === storageScopeKey) void load(STUDIO_OUTPUT_SOURCES.filter(source => source.event === detail.toolId));
    };
    const focused = () => { void load(STUDIO_OUTPUT_SOURCES); };
    window.addEventListener(STUDIO_OUTPUT_SAVED, saved);
    window.addEventListener('focus', focused);
    return () => { controller.abort(); window.removeEventListener(STUDIO_OUTPUT_SAVED, saved); window.removeEventListener('focus', focused); };
  }, [attempt, guest, notebookId, references, storageScopeKey]);

  const current = state.scope === storageScopeKey ? state : null;
  const rows = Object.values(current?.rows || {}).filter((row): row is StudioSavedOutput => Boolean(row)).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const errors = Object.values(current?.errors || {}).filter(Boolean);
  return <section className="studio-saved-outputs" data-testid="studio-saved-outputs" aria-labelledby="studio-saved-heading">
    <div className="studio-saved-heading"><h3 id="studio-saved-heading">已生成</h3><span>各工具最近保存</span></div>
    {(current?.loading || !current) && !guest && <p role="status">正在读取…</p>}
    {rows.map(output => {
      const Icon = STUDIO_NAV.find(item => item.id === output.tool)?.icon || FileText;
      const label = STUDIO_OUTPUT_SOURCES.find(item => item.kind === output.kind)!.label;
      return <button type="button" key={output.kind} className="studio-saved-output" data-testid={`studio-saved-${output.kind}`} onClick={() => onOpen(output)} title={output.title}>
        <Icon size={22} aria-hidden="true" /><span><strong>{output.title}</strong><small>{label} · {new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(output.updatedAt))}</small></span>
      </button>;
    })}
    {!guest && current && !current.loading && !rows.length && !errors.length && <p>生成的内容会显示在这里。</p>}
    {guest && <p>访客内容仅保存在当前浏览器，可在相应工具中查看。</p>}
    {errors.length > 0 && <div role="alert" className="studio-output-errors"><p>{errors.join('；')}。已有内容未删除。</p><button type="button" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={14} />重新读取</button></div>}
  </section>;
}
