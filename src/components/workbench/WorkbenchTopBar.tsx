'use client';

import { ArrowLeft, LogOut } from 'lucide-react';
import { BrandMark } from '@/components/brand/BrandMark';

type WorkbenchTopBarProps = {
  workspaceTitle: string;
  onBackHome: () => void;
  onSignOut: () => void;
};

export function WorkbenchTopBar({
  workspaceTitle,
  onBackHome,
  onSignOut,
}: WorkbenchTopBarProps) {
  return (
    <header className="z-40 flex h-16 flex-shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/94 px-4 text-[var(--text-primary)] shadow-[0_10px_30px_rgba(15,23,42,0.06)] backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onBackHome}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--glass-subtle)] text-[var(--text-secondary)] transition hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]"
          aria-label="返回文献本列表"
          title="返回文献本列表"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <BrandMark compact className="hidden h-10 w-10 border-[var(--border-subtle)] shadow-none sm:block" />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold leading-5 sm:text-base" data-testid="workbench-topbar-title">
              {workspaceTitle}
            </p>
            <span className="hidden rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-500 sm:inline-flex">
              账号绑定
            </span>
          </div>
          <p className="truncate text-[11px] leading-4 text-[var(--text-tertiary)]">
            证据来源、问答和生成结果会保存在当前文献本。
          </p>
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2">
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
      </div>
    </header>
  );
}
