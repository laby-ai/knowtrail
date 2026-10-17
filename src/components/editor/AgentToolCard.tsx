'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, Loader2, Search } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { StudioWorkspacePanel } from '@/components/studio/StudioPanel';
import type { StudioTab } from '@/components/studio/StudioToolSwitcher';
import { RESEARCH_PLUGINS, type ResearchPluginId, type ResearchToolCall } from '@/lib/research-agent-contract';
import { createDiscoveredSourceFile } from '@/lib/discovered-source-file';
import { uploadDiscoveredSourceFiles } from '@/lib/discovered-source-upload';
import { clientApiRequest } from '@/lib/client-api';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import { PresentationSkillCard } from './PresentationSkillCard';
import { ReportSkillCard } from './ReportSkillCard';
import { ResearchDesignSkillCard, RetryResearchDesignSave } from './ResearchDesignSkillCard';
import { KnowledgeMapSkillCard, RetryKnowledgeMapSave } from './KnowledgeMapSkillCard';
import { DataPlanSkillCard, RetryDataPlanSave } from './DataPlanSkillCard';
import { LearningSkillCard, RetryLearningSave } from './LearningSkillCard';
import { IllustrationSkillCard, RetryIllustrationSave } from './IllustrationSkillCard';

const TABS: Record<ResearchPluginId, StudioTab> = {
  'paper-search': 'paper-search', 'deep-research': 'deep-research',
  'hypothesis-generation': 'hypothesis-generation', 'experiment-design': 'experiment-design',
  'knowledge-map': 'knowledge', 'data-processing': 'data-processing',
  'scientific-illustration': 'scientific-illustration', presentation: 'presentation',
  report: 'report', 'knowledge-cards': 'flashcards', quiz: 'quiz',
};

export function AgentToolCard({ call, messageId }: { call: ResearchToolCall; messageId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="agent-tool-card" data-testid="agent-tool-card" data-plugin={call.plugin}>
      <div className="agent-tool-heading">
        {call.status === 'running' ? <Loader2 size={17} className="animate-spin" /> : <Search size={17} />}
        <strong>{RESEARCH_PLUGINS[call.plugin]}</strong>
        {call.plugin !== 'report' && <span className="min-w-0 flex-1 truncate">{call.query}</span>}
      </div>
      {call.status === 'running' && <p role="status">正在处理…</p>}
      {call.status === 'failed' && <p role="alert">{call.error || '本次调用未完成，请重新发送。'}</p>}
      {call.status === 'failed' && call.pendingDesign && <RetryResearchDesignSave pending={call.pendingDesign} messageId={messageId} callId={call.id} />}
      {call.status === 'failed' && call.pendingKnowledgeMap && <RetryKnowledgeMapSave pending={call.pendingKnowledgeMap} messageId={messageId} callId={call.id} />}
      {call.status === 'failed' && call.pendingDataPlan && <RetryDataPlanSave pending={call.pendingDataPlan} messageId={messageId} callId={call.id} />}
      {call.status === 'failed' && call.pendingLearning && <RetryLearningSave pending={call.pendingLearning} messageId={messageId} callId={call.id} />}
      {call.status === 'failed' && call.pendingIllustration && <RetryIllustrationSave pending={call.pendingIllustration} messageId={messageId} callId={call.id} />}
      {call.status === 'ready' && call.results && <PaperResults call={call} messageId={messageId} />}
      {call.status === 'ready' && call.presentation && <PresentationSkillCard plan={call.presentation} messageId={messageId} callId={call.id} />}
      {call.status === 'ready' && call.report && <ReportSkillCard reference={call.report} />}
      {call.status === 'ready' && call.design && <ResearchDesignSkillCard reference={call.design} />}
      {call.status === 'ready' && call.knowledgeMap && <KnowledgeMapSkillCard reference={call.knowledgeMap} />}
      {call.status === 'ready' && call.dataPlan && <DataPlanSkillCard reference={call.dataPlan} />}
      {call.status === 'ready' && call.learning && <LearningSkillCard call={{ ...call, learning: call.learning }} messageId={messageId} />}
      {call.status === 'ready' && call.illustration && <IllustrationSkillCard reference={call.illustration} />}
      {call.status === 'ready' && !call.results && !call.presentation && !call.report && !call.design && !call.knowledgeMap && !call.dataPlan && !call.learning && !call.illustration && <>
        <button type="button" className="agent-plugin-open" onClick={() => setOpen(value => !value)} aria-expanded={open}>
          {open ? '收起' : `打开${RESEARCH_PLUGINS[call.plugin]}`}<ChevronDown size={16} />
        </button>
        {open && <div className="agent-plugin-window" data-testid="agent-plugin-window">
          <StudioWorkspacePanel compact activeTab={TABS[call.plugin]} onClose={() => setOpen(false)} />
        </div>}
      </>}
    </section>
  );
}

function PaperResults({ call, messageId }: { call: ResearchToolCall; messageId: string }) {
  const { addPaper, addFolder, activeFolderId, setActiveFolder, storageScopeKey, togglePaperSelection, chatPersistence } = useApp();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [expanded, setExpanded] = useState(false);
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);
  const abortRef = useRef<AbortController | null>(null);
  const liveScope = useRef(storageScopeKey);
  liveScope.current = storageScopeKey;
  const imported = new Set(call.ingestedSources?.map(source => source.link));
  useEffect(() => () => abortRef.current?.abort(), [storageScopeKey]);
  const ingest = async () => {
    if (busy || abortRef.current) return;
    const controller = new AbortController(); abortRef.current = controller;
    setBusy(true); setNotice('');
    try {
      const picked = (call.results || []).filter(item => selected.has(item.link) && !imported.has(item.link));
      const files: File[] = [];
      const fileLinks: string[] = [];
      const errors: string[] = [];
      for (const item of picked) {
        controller.signal.throwIfAborted();
        try {
          const file = await createDiscoveredSourceFile(item, async url => {
            const response = await clientApiRequest('/api/discover/fetch', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() }, body: JSON.stringify({ url, notebookId }) });
            const result = await response.json() as { text?: string; content?: string; title?: string; error?: string };
            if (!response.ok || !(result.text || result.content)) throw new Error(result.error || '原文暂时无法读取，请重试。');
            return { text: result.text || result.content || '', title: result.title };
          });
          files.push(file); fileLinks.push(item.link);
        } catch (error) {
          controller.signal.throwIfAborted();
          errors.push(`${item.title}：${error instanceof Error ? error.message : '原文读取失败'}`);
        }
      }
      controller.signal.throwIfAborted();
      const outcome = await uploadDiscoveredSourceFiles({ files, notebookId, signal: controller.signal });
      controller.signal.throwIfAborted();
      if (liveScope.current !== storageScopeKey) return;
      if (!outcome.papers.length) throw new Error(errors[0] || outcome.errors[0] || '加入资料失败，请重试。');
      const folder = activeFolderId || addFolder('论文检索');
      setActiveFolder(folder);
      outcome.papers.forEach(paper => { addPaper(folder, paper); window.setTimeout(() => { if (liveScope.current === storageScopeKey) togglePaperSelection(paper.id); }, 0); });
      const accepted = outcome.successfulFileIndexes.map((index, i) => ({ link: fileLinks[index], sourceId: outcome.papers[i].id }));
      const links = new Set(accepted.map(source => source.link));
      setSelected(previous => new Set([...previous].filter(link => !links.has(link))));
      chatPersistence.update(previous => ({ ...previous, messages: previous.messages.map(message => message.id !== messageId ? message : { ...message, toolCalls: message.toolCalls?.map(tool => tool.id === call.id ? { ...tool, ingestedSources: [...(tool.ingestedSources || []).filter(source => !links.has(source.link)), ...accepted] } : tool) }) }));
      errors.push(...outcome.errors);
      const saved = await chatPersistence.flush();
      controller.signal.throwIfAborted();
      if (liveScope.current !== storageScopeKey) return;
      setNotice(`已加入 ${outcome.papers.length} 份资料。${errors.length ? `未加入的仍可重试：${errors.join('；')}` : ''}${saved ? '' : '导入标记尚未保存，请使用对话上方的重试保存。'}`);
    } catch (error) { if (!controller.signal.aborted && liveScope.current === storageScopeKey) setNotice(error instanceof Error ? error.message : '加入资料失败，请重试。'); }
    finally { if (abortRef.current === controller) abortRef.current = null; if (!controller.signal.aborted && liveScope.current === storageScopeKey) setBusy(false); }
  };
  return (
    <div className="agent-paper-results" data-testid="agent-paper-results">
      <p className="text-xs text-[var(--text-tertiary)]">{call.results?.length || 0} 条候选 · 摘要与公开元数据</p>
      {!call.results?.length && <p>没有找到相关论文，可以换个关键词继续。</p>}
      {call.results?.slice(0, expanded ? 20 : 3).map((item, index) => <article key={item.link}>
        <label className="flex min-w-0 items-start gap-2">
          <input type="checkbox" disabled={busy || imported.has(item.link)} aria-label={`选择${item.title}`} checked={selected.has(item.link) && !imported.has(item.link)} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(item.link); else next.delete(item.link); return next; })} />
          <span className="min-w-0"><a href={item.link} target="_blank" rel="noopener noreferrer">{index + 1}. {item.title}<ExternalLink size={13} className="ml-1 inline" /></a><small>{item.authors?.join('、')}{item.date ? ` · ${item.date.slice(0, 10)}` : ''}{imported.has(item.link) ? ' · 已加入资料' : ''}</small></span>
        </label>
        <details><summary>查看摘要</summary><p>{item.snippet}</p></details>
      </article>)}
      {(call.results?.length || 0) > 3 && <button type="button" className="text-left text-xs text-[var(--text-secondary)]" onClick={() => setExpanded(value => !value)}>{expanded ? '收起结果' : `查看其余 ${(call.results?.length || 0) - 3} 篇`}</button>}
      {!!call.results?.length && <button type="button" data-testid="agent-ingest" className="agent-plugin-open" disabled={!selected.size || busy} onClick={() => void ingest()}>{busy ? '正在加入…' : `加入资料${selected.size ? `（${selected.size}）` : ''}`}</button>}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
