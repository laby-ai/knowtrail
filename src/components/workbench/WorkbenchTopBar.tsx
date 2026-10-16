'use client';

import { ArrowLeft, ChevronDown, Grid3X3, LogOut, UserRound } from 'lucide-react';
import { BrandMark } from '@/components/brand/BrandMark';

type WorkbenchTopBarProps = {
  workspaceTitle: string;
  onBackHome: () => void;
  onSignOut: () => void;
  embedded: boolean;
  authenticated: boolean;
  templateCopy?: boolean;
};

export function WorkbenchTopBar({
  workspaceTitle,
  onBackHome,
  onSignOut,
  embedded,
  authenticated,
  templateCopy = false,
}: WorkbenchTopBarProps) {
  const shellClass = embedded
    ? 'quiet-topbar z-40 flex flex-shrink-0 items-center justify-between gap-3 border-b border-[#E4E9F1] bg-white text-[#142033]'
    : 'z-40 flex h-16 flex-shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/94 px-4 text-[var(--text-primary)] shadow-[0_10px_30px_rgba(15,23,42,0.06)] backdrop-blur-xl';

  return (
    <header className={shellClass}>
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onBackHome}
          className={embedded ? 'quiet-notebook-home' : 'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--glass-subtle)] text-[var(--text-secondary)] transition hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]'}
          aria-label="返回文献本列表"
          title="返回文献本列表"
        >
          {embedded ? <Grid3X3 size={22} /> : <ArrowLeft className="pointer-events-none h-4 w-4" />}
        </button>
        {!embedded && (
          <BrandMark compact className="hidden h-10 w-10 border-[var(--border-subtle)] shadow-none sm:block" />
        )}
        <span className="quiet-brand hidden text-lg font-semibold tracking-tight sm:block">KnowTrail</span>
        <div className="min-w-0 border-l border-[var(--border-subtle)] pl-3">
          <div className="flex min-w-0 items-center gap-2">
            {embedded ? (
              <button type="button" onClick={onBackHome} className="quiet-notebook-switch" aria-label="选择文献本">
                <span className="truncate" data-testid="workbench-topbar-title">{workspaceTitle}</span><ChevronDown size={18} />
              </button>
            ) : <p className="truncate text-sm font-semibold leading-5 sm:text-base" data-testid="workbench-topbar-title">{workspaceTitle}</p>}
            {templateCopy && <span className="text-xs text-[var(--text-tertiary)]">模板副本</span>}
          </div>
          {!embedded && !authenticated && <p className="text-xs text-[var(--text-tertiary)]">访客 · 仅保存在此浏览器</p>}
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2">
        {embedded && !authenticated && <span className="quiet-account-mark" role="img" aria-label="平台账号"><UserRound size={20} /></span>}
        {authenticated && (
          <button
            type="button"
            onClick={onSignOut}
            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--glass-subtle)] text-[var(--text-secondary)] transition hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]"
            aria-label="退出当前账号"
            title="退出当前账号"
            data-testid="workbench-topbar-sign-out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    </header>
  );
}
