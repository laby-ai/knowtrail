'use client';

import type { ElementType } from 'react';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';

export interface StudioJobProgressStage {
  key: string;
  label: string;
  icon?: ElementType;
}

interface StudioJobProgressProps {
  title: string;
  message: string;
  stages: StudioJobProgressStage[];
  currentStageKey: string;
  elapsedSeconds?: number;
  progressPercent?: number;
  hint?: string;
  status?: 'running' | 'failed' | 'succeeded';
  error?: string | null;
  onCancel?: () => void;
  cancelLabel?: string;
  testId?: string;
  indeterminate?: boolean;
}

export function StudioJobProgress({
  title,
  message,
  stages,
  currentStageKey,
  elapsedSeconds = 0,
  progressPercent: progressPercentOverride,
  hint,
  status = 'running',
  error,
  onCancel,
  cancelLabel = '取消生成',
  testId = 'studio-job-progress',
  indeterminate = false,
}: StudioJobProgressProps) {
  const currentStageIndex = Math.max(0, stages.findIndex(stage => stage.key === currentStageKey));
  const activeStageIndex = currentStageIndex === -1 ? 0 : currentStageIndex;
  const progressPercent = status === 'succeeded'
    ? 100
    : typeof progressPercentOverride === 'number'
      ? Math.max(0, Math.min(99, Math.round(progressPercentOverride)))
      : Math.min(96, Math.round(((activeStageIndex + 1) / Math.max(1, stages.length)) * 100));

  return (
    <div className="w-full rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-subtle)] p-4 shadow-[var(--glass-shadow-sm)]" data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            {status === 'failed' ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            ) : status === 'succeeded' ? (
              <Check className="h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-400" />
            )}
            <span>{title}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{message}</p>
        </div>
        <div className="shrink-0 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1 text-[10px] font-medium text-[var(--text-tertiary)]">
          {elapsedSeconds > 0 ? `${elapsedSeconds}s` : indeterminate && status === 'running' ? '等待结果' : `${progressPercent}%`}
        </div>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--border-subtle)]">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            status === 'failed' ? 'bg-rose-400' : status === 'succeeded' ? 'bg-emerald-400' : 'bg-blue-500'
          }`}
          style={{ width: indeterminate && status === 'running' ? '40%' : `${progressPercent}%` }}
          role="progressbar"
          aria-label={indeterminate ? '等待服务端结果，暂无完成百分比' : message}
          aria-valuenow={indeterminate && status === 'running' ? undefined : progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>

      {hint && status === 'running' && (
        <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-200">
          {hint}
        </div>
      )}

      {error && status === 'failed' && (
        <div className="mt-3 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-700 dark:text-rose-200">
          {error}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {stages.map((stage, index) => {
          const StageIcon = stage.icon;
          const isDone = status === 'succeeded' || index < activeStageIndex;
          const isActive = status === 'running' && index === activeStageIndex;
          const isFailed = status === 'failed' && index === activeStageIndex;

          return (
            <div key={stage.key} className="flex items-center gap-2.5">
              <div
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                  isDone
                    ? 'border-emerald-400/25 bg-emerald-500/15 text-emerald-400'
                    : isFailed
                      ? 'border-rose-400/25 bg-rose-500/15 text-rose-400'
                      : isActive
                        ? 'border-blue-400/35 bg-blue-500/15 text-blue-400'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-quaternary)]'
                }`}
              >
                {isDone ? (
                  <Check className="h-3.5 w-3.5" />
                ) : isActive ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : StageIcon ? (
                  <StageIcon className="h-3.5 w-3.5" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                )}
              </div>
              <span
                className={`text-xs transition-colors ${
                  isDone
                    ? 'text-emerald-500 dark:text-emerald-300'
                    : isFailed
                      ? 'text-rose-500 dark:text-rose-300'
                      : isActive
                        ? 'font-medium text-[var(--text-primary)]'
                        : 'text-[var(--text-tertiary)]'
                }`}
              >
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>

      {onCancel && status === 'running' && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-4 w-full rounded-xl border border-[var(--glass-border)] bg-[var(--bg-card)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
        >
          {cancelLabel}
        </button>
      )}
    </div>
  );
}
