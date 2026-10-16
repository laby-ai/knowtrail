'use client';

import { useState } from 'react';
import { useApp } from '@/contexts/AppContext';
import { StructuredPresentationPanel } from '@/components/studio/StructuredPresentationPanel';
import { useStructuredPresentationFile } from '@/hooks/use-structured-presentation-file';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import type { ResearchPresentationPlan } from '@/lib/research-agent-contract';

export function PresentationSkillCard({ plan, messageId, callId }: { plan: ResearchPresentationPlan; messageId: string; callId: string }) {
  const { chatPersistence } = useApp();
  const [open, setOpen] = useState(false);
  const patch = (updates: Partial<ResearchPresentationPlan>) => chatPersistence.update(previous => ({
    ...previous, messages: previous.messages.map(message => message.id !== messageId ? message : {
      ...message, toolCalls: message.toolCalls?.map(call => call.id === callId && call.presentation ? { ...call, presentation: { ...call.presentation, ...updates } } : call),
    }),
  }));
  if (plan.artifact) return <PresentationArtifact id={plan.artifact.id} />;
  return <div data-testid="agent-presentation-plan">
    <p className="text-xs text-[var(--text-secondary)]">{plan.sourceIds.length} 份来源 · {plan.outlineDraft.length} 页 · 确认后生成可编辑 PPT</p>
    <button type="button" className="agent-plugin-open" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? '收起大纲' : '检查大纲并生成'}</button>
    {open && <StructuredPresentationPanel skillPlan={plan} onPlanChange={outlineDraft => patch({ outlineDraft })} onArtifact={async artifact => {
      patch({ artifact });
      if (!await chatPersistence.flush()) throw new Error('PPT已保存，对话引用尚未保存。请使用对话上方的重试保存。');
    }} />}
  </div>;
}

function PresentationArtifact({ id }: { id: string }) {
  const { storageScopeKey } = useApp();
  const [error, setError] = useState<string | null>(null);
  const file = useStructuredPresentationFile(storageScopeKey, notebookIdFromStorageScopeKey(storageScopeKey), setError, id);
  return <div data-testid="agent-presentation-artifact">
    {file.isRestoring ? <p role="status">正在读取PPT…</p> : file.presentation && <>
      <p className="break-all text-sm">{file.presentation.fileName}</p>
      <p className="text-xs text-[var(--text-secondary)]">{file.presentation.slideCount} 页 · 可编辑 PPTX</p>
      <button type="button" className="agent-plugin-open" disabled={file.isDownloading} onClick={() => void file.handleDownload()}>{file.isDownloading ? '正在下载…' : '下载本轮PPT'}</button>
    </>}
    {(file.restoreError || error) && <p role="alert">{file.restoreError || error}</p>}
    {file.restoreError && <button type="button" className="agent-plugin-open" onClick={file.retryRestore}>重新读取</button>}
  </div>;
}
