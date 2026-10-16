'use client';

import { clientApiPath, clientApiRequest } from '@/lib/client-api';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, LoaderCircle, Square, TableProperties } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { usePrivateNotebookDocument } from '@/hooks/use-private-notebook-document';
import { emptyDataProcessing, isDataProcessingDocument, type DataProcessingDocument } from '@/lib/data-processing-document';
import { studioSessionStorageKey } from '@/lib/studio-session-storage';
import type { NotebookDocument } from '@/lib/private-notebook-document';
import { accountAuthHeaders } from '@/lib/account-session-browser';
import type { DataProcessingPlan, DataTaskFamily } from '@/lib/data-processing-plan';
import { buildDataTablePreviewForPaper } from '@/lib/data-table-preview';
import { notebookIdFromStorageScopeKey } from '@/lib/notebook-scope';
import type { Paper } from '@/types';

type PanelStatus = 'idle' | 'running' | 'complete' | 'error';

const TASK_OPTIONS: Array<{ id: DataTaskFamily; label: string; desc: string }> = [
  { id: 'description', label: '描述与质量检查', desc: '先核对字段、缺失、分布和异常范围' },
  { id: 'prediction', label: '预测任务', desc: '明确目标列、切分规则、baseline 和指标' },
  { id: 'comparison', label: '组间比较', desc: '明确分组、目标、效应量和不确定性' },
  { id: 'trend', label: '时间趋势', desc: '使用时间切分和朴素时序 baseline' },
];

function legacyData(scope: string): DataProcessingDocument | null {
  try {
    const next = emptyDataProcessing();
    const fields = { sourceId: 'source-id', question: 'question', sampleUnit: 'sample-unit', taskFamily: 'task-family', targetColumn: 'target-column', splitColumn: 'split-column' };
    for (const [key, field] of Object.entries(fields)) Object.assign(next, { [key]: JSON.parse(sessionStorage.getItem(studioSessionStorageKey(scope, 'data-processing', field)) || 'null') ?? next[key as keyof typeof next] });
    return (next.question || next.sampleUnit) && isDataProcessingDocument(next) ? next : null;
  } catch { return null; }
}

function toPaperRequest(paper: Paper): Paper {
  return {
    id: paper.id,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    abstract: paper.abstract,
    content: paper.content,
    rawContent: paper.rawContent,
    shortName: paper.shortName,
    keywords: paper.keywords,
    fileName: paper.fileName,
    fileType: paper.fileType,
    fileSize: paper.fileSize,
    fileUrl: paper.fileUrl,
    fileKey: paper.fileKey,
    uploadTime: paper.uploadTime,
  };
}

export function DataProcessingPanel() {
  const { getSelectedPapers, storageScopeKey } = useApp();
  const notebookId = notebookIdFromStorageScopeKey(storageScopeKey);
  const dataSources = getSelectedPapers().filter(paper => paper.fileType === 'csv' || paper.fileType === 'xlsx');
  const saved = usePrivateNotebookDocument({ scopeKey: storageScopeKey, toolId: 'data-processing', endpoint: '/api/studio/artifacts?kind=data-processing', empty: emptyDataProcessing, validate: isDataProcessingDocument, readLegacy: legacyData });
  const { sourceId, question, sampleUnit, taskFamily, targetColumn, splitColumn, plan } = saved.data;
  const field = <K extends keyof DataProcessingDocument>(key: K, value: DataProcessingDocument[K]) => saved.update(previous => ({ ...previous, [key]: value }));
  const setSourceId = (value: string) => field('sourceId', value);
  const setQuestion = (value: string) => field('question', value);
  const setSampleUnit = (value: string) => field('sampleUnit', value);
  const setTaskFamily = (value: DataTaskFamily) => field('taskFamily', value);
  const setTargetColumn = (value: string) => field('targetColumn', value);
  const setSplitColumn = (value: string) => field('splitColumn', value);
  const [status, setStatus] = useState<PanelStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { abortRef.current?.abort(); abortRef.current = null; }, []);
  useEffect(() => { if (!saved.unsaved) setError(null); }, [saved.unsaved]);

  useEffect(() => {
    if (saved.loading || dataSources.length === 0 || dataSources.some(source => source.id === sourceId)) return;
    setSourceId(dataSources[0]?.id || '');
  }, [dataSources, sourceId, saved.loading]);

  const selectedSource = dataSources.find(source => source.id === sourceId) || null;
  const preview = useMemo(
    () => selectedSource ? buildDataTablePreviewForPaper(selectedSource) : null,
    [selectedSource],
  );
  const columns = useMemo(() => preview?.columns || [], [preview]);
  const needsTarget = taskFamily !== 'description';
  const needsSplit = taskFamily === 'comparison' || taskFamily === 'trend';

  useEffect(() => {
    if (saved.loading || columns.length === 0) return;
    if (!columns.some(column => column.name === targetColumn)) setTargetColumn('');
    if (!columns.some(column => column.name === splitColumn)) setSplitColumn('');
  }, [columns, splitColumn, targetColumn, saved.loading]);

  const runPlan = useCallback(async () => {
    if (!selectedSource || !preview || status === 'running' || saved.loading || saved.error) return;
    if (!question.trim() || !sampleUnit.trim() || (needsTarget && !targetColumn) || (needsSplit && !splitColumn)) return;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(new Error('data processing request timed out')), 30_000);
    abortRef.current = controller;
    setStatus('running');
    setError(null);

    try {
      if (!await saved.flush()) throw new Error('当前内容尚未保存，请先重试保存。');
      const response = await clientApiRequest('/api/data-processing/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountAuthHeaders() },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify({
          question: question.trim(),
          sampleUnit: sampleUnit.trim(),
          taskFamily,
          targetColumn: targetColumn || undefined,
          splitColumn: splitColumn || undefined,
          notebookId,
          paper: toPaperRequest(selectedSource),
          persistArtifact: !storageScopeKey.startsWith('guest:'), expectedRevision: saved.revision.current,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        code?: number;
        msg?: string;
        data?: DataProcessingPlan;
        document?: NotebookDocument<DataProcessingDocument>;
        unsavedDocument?: DataProcessingDocument;
      } | null;
      if (controller.signal.aborted) return;
      if (isDataProcessingDocument(payload?.unsavedDocument)) saved.updateLocal(() => payload!.unsavedDocument!);
      if (!response.ok || payload?.code !== 0 || !payload.data) {
        throw new Error(payload?.msg || `数据处理请求失败（HTTP ${response.status}）。`);
      }
      if (payload.document && isDataProcessingDocument(payload.document.data)) saved.acceptSaved(payload.document);
      else if (storageScopeKey.startsWith('guest:')) saved.updateLocal(previous => ({ ...previous, plan: payload.data! }));
      else throw new Error('方案缺少保存回执，请重新读取。');
      setStatus('complete');
    } catch (caught) {
      if (controller.signal.aborted && abortRef.current !== controller) return;
      const stopped = controller.signal.aborted;
      setError(stopped
        ? '数据处理已取消或超过等待时间，未生成不完整方案。'
        : caught instanceof Error ? caught.message : '数据处理暂时不可用，请稍后重试。');
      setStatus('error');
    } finally {
      window.clearTimeout(timeoutId);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [needsSplit, needsTarget, notebookId, preview, question, sampleUnit, saved, selectedSource, splitColumn, status, storageScopeKey, targetColumn, taskFamily]);

  const cancelPlan = useCallback(() => abortRef.current?.abort(), []);
  const downloadPlan = useCallback(() => {
    if (!plan) return;
    const guest = storageScopeKey.startsWith('guest:');
    const url = guest ? URL.createObjectURL(new Blob([plan.artifactMarkdown], { type: 'text/markdown;charset=utf-8' })) : clientApiPath(`/api/studio/artifacts?${new URLSearchParams({ kind: 'data-processing', notebookId: notebookId || '', download: '1', revision: saved.revision.current || '' })}`);
    const link = document.createElement('a');
    link.href = url;
    link.download = plan.artifactFileName;
    link.click();
    if (guest) URL.revokeObjectURL(url);
  }, [notebookId, plan, saved.revision, storageScopeKey]);

  const canRun = Boolean(
    !saved.loading && !saved.error && !(saved.unsaved && error) && selectedSource && preview && question.trim() && sampleUnit.trim() &&
    (!needsTarget || targetColumn) && (!needsSplit || splitColumn),
  );

  return (
    <div className="space-y-4" data-testid="data-processing-panel">
      {saved.loading && <p className="text-xs" data-testid="data-processing-restoring">正在读取已保存方案…</p>}
      {saved.error && <div className="rounded-xl border p-3 text-xs" role="alert" data-testid="data-processing-save-error"><p>{saved.error}</p><button type="button" className="mt-2 underline" onClick={saved.conflict ? saved.reload : saved.readFailed ? saved.retryRead : saved.retry}>{saved.conflict ? '读取已保存内容（将替换当前草稿）' : saved.readFailed ? '重试读取' : '重试保存'}</button></div>}
      {saved.unsaved && !saved.error && status === 'error' && <button type="button" className="text-xs underline" onClick={saved.retry}>内容尚未保存，重试保存</button>}
      {storageScopeKey.startsWith('guest:') && <p className="text-xs">访客方案仅保存在当前浏览器。</p>}
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <TableProperties className="h-4 w-4 text-teal-500" />
          基于真实表格定义数据任务
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          先明确样本、输入、输出、切分和 baseline。这里只生成可复核方案，不声称已训练模型或完成统计检验。
        </p>
      </div>

      {dataSources.length === 0 ? (
        <div className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-3 text-[11px] leading-relaxed text-amber-700 dark:text-amber-200" data-testid="data-processing-empty">
          尚未选择 CSV 或 XLSX 来源。请先在左侧文献本上传并选中一个真实数据表。
        </div>
      ) : (
        <>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">数据来源</span>
            <select
              value={sourceId}
              onChange={event => setSourceId(event.target.value)}
              disabled={status === 'running' || saved.loading || saved.readFailed}
              data-testid="data-processing-source"
              className="mt-1.5 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
            >
              {dataSources.map(source => <option key={source.id} value={source.id}>{source.shortName || source.title}</option>)}
            </select>
          </label>

          {preview ? (
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--glass-subtle)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)]" data-testid="data-processing-preview">
              {preview.sheetName ? `${preview.sheetName} · ` : ''}{preview.rowCount} 行 × {preview.columnCount} 列
              {' · '}{preview.columns.filter(column => column.missingCount > 0).length} 个字段存在缺失
              <span className="mt-1 block text-[var(--text-tertiary)]">字段：{preview.columns.map(column => column.name).join('、')}</span>
            </div>
          ) : (
            <div className="rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-700 dark:text-rose-200">
              当前来源尚未解析出可用表格，请检查文件内容后重新上传。
            </div>
          )}

          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">科研问题</span>
            <textarea
              value={question}
              onChange={event => setQuestion(event.target.value)}
              disabled={status === 'running' || saved.loading || saved.readFailed}
              maxLength={1200}
              data-testid="data-processing-question"
              placeholder="例如：能否用入组时信息预测治疗响应？"
              className="mt-1.5 min-h-20 w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2.5 text-sm leading-relaxed text-[var(--text-primary)] outline-none focus:border-teal-400/60"
            />
          </label>

          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">一行数据代表</span>
            <input
              value={sampleUnit}
              onChange={event => setSampleUnit(event.target.value)}
              disabled={status === 'running' || saved.loading || saved.readFailed}
              maxLength={200}
              data-testid="data-processing-sample-unit"
              placeholder="例如：单个患者、单次实验或一个材料样本"
              className="mt-1.5 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-teal-400/60"
            />
          </label>

          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">数据任务</span>
            <select
              value={taskFamily}
              onChange={event => setTaskFamily(event.target.value as DataTaskFamily)}
              disabled={status === 'running' || saved.loading || saved.readFailed}
              data-testid="data-processing-task"
              className="mt-1.5 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
            >
              {TASK_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}：{option.desc}</option>)}
            </select>
          </label>

          {needsTarget && (
            <label className="block">
              <span className="text-[11px] font-medium text-[var(--text-secondary)]">目标列</span>
              <select
                value={targetColumn}
                onChange={event => setTargetColumn(event.target.value)}
                disabled={status === 'running' || saved.loading || saved.readFailed}
                data-testid="data-processing-target"
                className="mt-1.5 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
              >
                <option value="">请选择</option>
                {columns.map(column => <option key={column.name} value={column.name}>{column.name} · {column.type}</option>)}
              </select>
            </label>
          )}

          {(needsSplit || taskFamily === 'prediction') && (
            <label className="block">
              <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                {taskFamily === 'trend' ? '时间列' : taskFamily === 'comparison' ? '分组列' : '分组 / 时间 / 批次列（建议）'}
              </span>
              <select
                value={splitColumn}
                onChange={event => setSplitColumn(event.target.value)}
                disabled={status === 'running' || saved.loading || saved.readFailed}
                data-testid="data-processing-split"
                className="mt-1.5 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
              >
                <option value="">{needsSplit ? '请选择' : '暂未指定'}</option>
                {columns.filter(column => column.name !== targetColumn).map(column => <option key={column.name} value={column.name}>{column.name}</option>)}
              </select>
            </label>
          )}

          <button
            type="button"
            onClick={() => void runPlan()}
            disabled={!canRun || status === 'running'}
            data-testid="data-processing-start"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-500 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <TableProperties className="h-4 w-4" />
            生成数据处理方案
          </button>
        </>
      )}

      {status === 'running' && (
        <div className="rounded-lg border border-teal-400/25 bg-teal-500/10 px-3 py-3" data-testid="data-processing-progress">
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin text-teal-500" />
            正在核对表格字段、数据质量、切分边界和 baseline。
          </div>
          <button type="button" onClick={cancelPlan} className="mt-2 flex items-center gap-1 text-[11px] font-medium text-rose-600 dark:text-rose-300">
            <Square className="h-3 w-3" /> 取消
          </button>
        </div>
      )}

      {error && status === 'error' && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2" data-testid="data-processing-error">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
          <p className="text-[11px] leading-relaxed text-rose-700 dark:text-rose-200">{error}</p>
        </div>
      )}

      {plan && !saved.loading && status !== 'running' && (
        <div className="space-y-3" data-testid="data-processing-result">
          <div className="flex items-start gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-3 py-2">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
            <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
              已生成基于真实字段的数据合同和 baseline 方案；尚未执行模型训练或统计检验。
            </p>
          </div>

          <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
            <h3 className="text-xs font-semibold text-[var(--text-primary)]">数据合同</h3>
            <dl className="mt-2 grid gap-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              <div>来源：{plan.dataset.sourceTitle}</div>
              <div>规模：{plan.dataset.rowCount} 行 × {plan.dataset.columnCount} 列</div>
              <div>样本单位：{plan.contract.sampleUnit}</div>
              <div>任务：{plan.recommendation.taskLabel}</div>
              <div>目标列：{plan.contract.targetColumn || '未指定'}</div>
            </dl>
          </section>

          <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
            <h3 className="text-xs font-semibold text-[var(--text-primary)]">数据质量与泄漏风险</h3>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              {[...plan.dataQuality.warnings, ...plan.split.leakageRisks].map(item => <li key={item}>{item}</li>)}
            </ul>
          </section>

          <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
            <h3 className="text-xs font-semibold text-[var(--text-primary)]">Baseline 与评估</h3>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">{plan.recommendation.baseline}</p>
            <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">指标：{plan.recommendation.metrics.join('、')}</p>
            <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">切分：{plan.split.rule}</p>
          </section>

          <div className="rounded-lg border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
            {plan.boundary}
          </div>

          <button
            type="button"
            onClick={downloadPlan}
            disabled={!storageScopeKey.startsWith('guest:') && (saved.unsaved || Boolean(saved.error))}
            data-testid="data-processing-download"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-teal-400/30 bg-teal-500/10 px-3 py-2.5 text-sm font-medium text-teal-700 transition hover:bg-teal-500/15 dark:text-teal-200"
          >
            <Download className="h-4 w-4" />
            下载方案
          </button>
        </div>
      )}
    </div>
  );
}
