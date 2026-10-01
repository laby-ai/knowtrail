'use client';

import { AlertTriangle } from 'lucide-react';
import type { StudioGenerationState } from '@/lib/studio-generation-readiness';

export function ImagePptGenerationFeedback({
  readiness,
  notice,
  error,
  isGenerating,
  hasSelectedPapers,
  onRetry,
}: {
  readiness: StudioGenerationState;
  notice: string | null;
  error: string | null;
  isGenerating: boolean;
  hasSelectedPapers: boolean;
  onRetry: () => void;
}) {
  return (
    <>
      {!readiness.ready && (
        <div data-testid="image-ppt-readiness" className="rounded-xl border border-amber-400/25 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200">
          {readiness.message}
        </div>
      )}
      {notice && !isGenerating && (
        <div className="liquid-glass-card border border-[var(--border-subtle)] p-3 text-xs text-[var(--text-secondary)]">
          {notice}
        </div>
      )}
      {error && !isGenerating && (
        <div data-testid="image-ppt-error" className="liquid-glass-card space-y-3 border border-rose-400/35 bg-rose-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-semibold text-[var(--text-primary)]">图片 PPT 生成失败</p>
              <p className="break-words text-xs leading-relaxed text-[var(--text-secondary)]">{error}</p>
              <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                文本模型已进入生成流程，但账号绑定的图片模型暂时不可用。请稍后重试或联系服务方检查模型配置。
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="image-ppt-retry"
            onClick={onRetry}
            disabled={!hasSelectedPapers || !readiness.ready}
            className="liquid-glass-btn px-3 py-2 text-xs text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            重试生成
          </button>
        </div>
      )}
    </>
  );
}
