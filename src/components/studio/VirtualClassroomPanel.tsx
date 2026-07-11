'use client';

import { clientApiRequest } from '@/lib/client-api';

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, GraduationCap, HelpCircle, RefreshCw } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import {
  buildVirtualClassroomEntry,
  CLASSROOM_ORIGIN,
} from '@/lib/virtual-classroom/workspace-entry';
import {
  VirtualClassroomOutlineCard,
  type ClassroomOutlineDraft,
  type ConfirmedClassroom,
} from './VirtualClassroomOutlineCard';
import { VirtualClassroomRecentList, type RecentClassroom } from './VirtualClassroomRecentList';

interface ClassroomStatus {
  ok: boolean;
  mode?: 'external' | 'unavailable';
  origin: string;
  recentClassrooms: RecentClassroom[];
}

export function VirtualClassroomPanel() {
  const { getSelectedPapers, openVirtualClassroom, virtualClassroomViewer } = useApp();
  const selectedPapers = getSelectedPapers();
  const selectedSourceSignature = selectedPapers.map(paper => paper.id).join('|');
  const [status, setStatus] = useState<ClassroomStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [outlineDraft, setOutlineDraft] = useState<ClassroomOutlineDraft | null>(null);
  const [outlineArtifactPath, setOutlineArtifactPath] = useState<string | null>(null);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineError, setOutlineError] = useState<string | null>(null);
  const [confirmingOutline, setConfirmingOutline] = useState(false);
  const [confirmedClassroom, setConfirmedClassroom] = useState<ConfirmedClassroom | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const classroomOrigin = status?.ok && status.mode === 'external' ? status.origin : undefined;

  const loadStatus = async () => {
    setLoading(true);
    try {
      const response = await clientApiRequest('/api/virtual-classroom/status', { cache: 'no-store' });
      const data = (await response.json()) as ClassroomStatus;
      setStatus(data);
    } catch {
      setStatus({ ok: false, mode: 'unavailable', origin: CLASSROOM_ORIGIN, recentClassrooms: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const openFullClassroom = () => {
    if (!classroomOrigin) return;
    openVirtualClassroom(buildVirtualClassroomEntry(selectedPapers, classroomOrigin));
  };

  useEffect(() => {
    if (loading || !classroomOrigin || selectedPapers.length === 0) return;
    if (virtualClassroomViewer?.source === 'confirmed') return;
    if (virtualClassroomViewer?.sourceIds?.join('|') === selectedSourceSignature) return;
    openFullClassroom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, classroomOrigin, selectedSourceSignature, selectedPapers.length, virtualClassroomViewer?.source]);

  const generateOutlineDraft = async () => {
    if (selectedPapers.length === 0) {
      setOutlineError('请先在左侧选择资料，再生成课程大纲。');
      return;
    }

    setOutlineLoading(true);
    setOutlineError(null);
    setOutlineDraft(null);
    setOutlineArtifactPath(null);
    setConfirmedClassroom(null);
    setConfirmError(null);

    try {
      const response = await clientApiRequest('/api/virtual-classroom/outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          papers: selectedPapers.map(paper => ({
            id: paper.id,
            title: paper.title,
            shortName: paper.shortName,
            abstract: paper.abstract,
            content: (paper.rawContent || paper.content || '').slice(0, 8000),
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '课程大纲生成失败');
      }
      setOutlineDraft(data.draft as ClassroomOutlineDraft);
      setOutlineArtifactPath(typeof data.artifactPath === 'string' ? data.artifactPath : null);
    } catch (error) {
      setOutlineError(error instanceof Error ? error.message : '课程大纲生成失败');
    } finally {
      setOutlineLoading(false);
    }
  };

  const confirmOutlineDraft = async () => {
    if (!outlineDraft) {
      setConfirmError('请先生成课程大纲，再确认课堂。');
      return;
    }

    setConfirmingOutline(true);
    setConfirmError(null);

    try {
      const response = await clientApiRequest('/api/virtual-classroom/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft: outlineDraft }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '确认课堂失败');
      }
      setOutlineDraft(data.confirmed as ClassroomOutlineDraft);
      openVirtualClassroom({
        url: data.classroomUrl,
        title: data.confirmed.title,
        source: 'confirmed',
        sourceCount: data.confirmed.sourceCount,
        sceneCount: data.confirmed.sceneCount,
        actionsCount: data.confirmed.actionsCount,
        scenes: data.confirmed.scenes,
        evidence: data.confirmed.evidence,
      });
      setConfirmedClassroom({
        confirmationStatus: 'confirmed',
        classroomUrl: data.classroomUrl,
        artifactPath: typeof data.artifactPath === 'string' ? data.artifactPath : undefined,
      });
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : '确认课堂失败');
    } finally {
      setConfirmingOutline(false);
    }
  };

  const openConfirmedClassroom = () => {
    if (!confirmedClassroom || !outlineDraft) return;
    openVirtualClassroom({
      url: confirmedClassroom.classroomUrl,
      title: outlineDraft.title,
      source: 'confirmed',
      sourceCount: outlineDraft.sourceCount,
      sceneCount: outlineDraft.sceneCount,
      actionsCount: outlineDraft.actionsCount,
      scenes: outlineDraft.scenes,
      evidence: outlineDraft.evidence,
    });
  };

  return (
    <div className="space-y-4" data-testid="virtual-classroom-panel">
      <div className="liquid-glass-card p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-subtle)]">
            <GraduationCap className="h-5 w-5 text-[var(--accent-blue)]" />
          </div>
          <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--text-primary)]">虚拟课堂</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                生成大纲后进入中间工作区。
              </p>
            </div>
            <button
              type="button"
              className="rounded-full p-1.5 text-[var(--text-tertiary)] transition hover:bg-[var(--glass-hover)] hover:text-[var(--text-primary)]"
              title="先选择资料，再生成课程大纲；确认后课堂会在中间工作区打开。"
              aria-label="虚拟课堂说明"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-subtle)] px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-medium">
            {status?.ok ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <AlertCircle className="h-4 w-4 text-amber-500" />
            )}
            <span className="text-[var(--text-primary)]">
              {loading ? '正在检查课堂...' : classroomOrigin ? '课堂服务可用' : '课堂服务未连接'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void loadStatus()}
            className="rounded-full p-1.5 text-[var(--text-secondary)] transition hover:bg-[var(--glass-hover)] hover:text-[var(--text-primary)]"
            title="刷新课堂状态"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <button
          type="button"
          onClick={openFullClassroom}
          disabled={!classroomOrigin || selectedPapers.length === 0}
          className="liquid-glass-btn mt-4 w-full px-4 py-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="virtual-classroom-open"
          title={selectedPapers.length > 0 ? '用左侧已选资料打开课堂' : '请先在左侧选择资料'}
        >
          <GraduationCap className="h-3.5 w-3.5" />
          {selectedPapers.length > 0 ? `打开课堂 · ${selectedPapers.length} 个资料` : '先选择资料'}
        </button>

        {virtualClassroomViewer && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-2" data-testid="virtual-classroom-active-status">
            <div className="flex min-w-0 items-center gap-2 text-[11px] font-semibold text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{virtualClassroomViewer.title || '课堂已打开'}</span>
            </div>
            <button
              type="button"
              onClick={() => openVirtualClassroom({
                url: virtualClassroomViewer.url,
                title: virtualClassroomViewer.title,
                source: virtualClassroomViewer.source,
                sourceCount: virtualClassroomViewer.sourceCount,
                sourceIds: virtualClassroomViewer.sourceIds,
                sourceSummary: virtualClassroomViewer.sourceSummary,
                sceneCount: virtualClassroomViewer.sceneCount,
                actionsCount: virtualClassroomViewer.actionsCount,
                scenes: virtualClassroomViewer.scenes,
                evidence: virtualClassroomViewer.evidence,
              })}
              className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-500/15"
              data-testid="virtual-classroom-return-opened"
            >
              回到课堂
            </button>
          </div>
        )}
      </div>

      <VirtualClassroomOutlineCard
        selectedCount={selectedPapers.length}
        outlineDraft={outlineDraft}
        outlineArtifactPath={outlineArtifactPath}
        outlineLoading={outlineLoading}
        outlineError={outlineError}
        confirmingOutline={confirmingOutline}
        confirmedClassroom={confirmedClassroom}
        confirmError={confirmError}
        onGenerate={() => void generateOutlineDraft()}
        onConfirm={() => void confirmOutlineDraft()}
        onOpenConfirmed={openConfirmedClassroom}
      />

      <div className="liquid-glass-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold text-[var(--text-primary)]">最近课堂</p>
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {status?.recentClassrooms.length ? `${status.recentClassrooms.length} 个可打开结果` : '暂无结果'}
          </span>
        </div>

        <VirtualClassroomRecentList
          origin={status?.origin || CLASSROOM_ORIGIN}
          recentClassrooms={status?.recentClassrooms || []}
          currentViewer={virtualClassroomViewer}
          openVirtualClassroom={openVirtualClassroom}
        />
      </div>
    </div>
  );
}
