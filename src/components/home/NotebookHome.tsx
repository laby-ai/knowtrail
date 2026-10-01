'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  LogOut,
  Plus,
  Search,
  UserRound,
} from 'lucide-react';
import { BrandMark } from '@/components/brand/BrandMark';
import { BailianProviderButton } from '@/components/account/BailianProviderButton';
import type { AccountAuthSession } from '@/lib/account-auth-client';
import {
  ACCOUNT_NOTEBOOK_NEXT,
  type AccountCenterStatus,
  type WorkspaceNotebook,
} from '@/components/home/workspace-types';
import {
  CreateNotebookCard,
  FeaturedNotebookStrip,
  NotebookCard,
} from '@/components/home/NotebookCards';
import { ThemeToggle } from '@/components/ui/theme-toggle';

type NotebookHomeProps = {
  notebooks: WorkspaceNotebook[];
  activeNotebookId: string | null;
  accountStatus: AccountCenterStatus | null;
  accountSession: AccountAuthSession | null;
  notebooksReady: boolean;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onOpenFeatured: (id: string) => void;
  onShowLanding: () => void;
  onSignOut: () => void;
};

function AccountArea({
  accountStatus,
  accountSession,
  onSignOut,
}: {
  accountStatus: AccountCenterStatus | null;
  accountSession: AccountAuthSession | null;
  onSignOut: () => void;
}) {
  if (!accountStatus?.configured) return null;

  if (!accountSession) {
    return (
      <Link
        href={`/account?next=${ACCOUNT_NOTEBOOK_NEXT}`}
        className="liquid-glass-btn inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-white transition"
        data-testid="notebook-home-account"
      >
        <UserRound className="h-4 w-4" />
        <span className="hidden sm:inline">登录账号</span>
      </Link>
    );
  }

  return (
    <div className="liquid-glass-card flex items-center gap-1.5 rounded-lg p-1" data-testid="notebook-home-account">
      <div className="flex h-8 w-8 items-center justify-center rounded-md text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.8) 0%, rgba(139, 92, 246, 0.8) 100%)' }}>
        {accountSession.member.display_name.slice(0, 1)}
      </div>
      <div className="hidden min-w-0 md:block">
        <div className="truncate text-sm font-semibold leading-4 text-white">{accountSession.member.display_name}</div>
        <div className="truncate text-xs leading-4 text-white/60">{accountSession.member.email}</div>
      </div>
      <BailianProviderButton session={accountSession} />
      <button
        type="button"
        onClick={onSignOut}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        aria-label="退出账号"
        title="退出账号"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}

export function NotebookHome({
  notebooks,
  activeNotebookId,
  accountStatus,
  accountSession,
  notebooksReady,
  onCreate,
  onOpen,
  onOpenFeatured,
  onShowLanding,
  onSignOut,
}: NotebookHomeProps) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const filteredNotebooks = notebooks.filter(notebook => notebook.title.toLowerCase().includes(normalizedQuery));

  return (
    <div className="notebook-home-page min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/20 px-4 py-3 backdrop-blur-xl sm:px-5">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <button
            type="button"
            onClick={onShowLanding}
            className="flex shrink-0 items-center gap-2.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            aria-label="返回 KnowTrail 首页"
          >
            <BrandMark compact />
            <span className="whitespace-nowrap text-xl font-semibold tracking-tight">KnowTrail</span>
          </button>

          <label className="mx-auto hidden w-full max-w-md md:block">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索文献本"
              className="liquid-glass-input h-10 w-full rounded-lg px-3.5 text-sm"
              data-testid="notebook-home-search"
            />
          </label>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <AccountArea accountStatus={accountStatus} accountSession={accountSession} onSignOut={onSignOut} />
            <button
              type="button"
              onClick={onCreate}
              disabled={!notebooksReady}
              className="liquid-glass-btn inline-flex h-10 w-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-4"
              style={{ background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.9) 0%, rgba(139, 92, 246, 0.9) 100%)' }}
              data-testid="notebook-home-create"
              aria-label="新建文献本"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">新建文献本</span>
            </button>
          </div>
        </div>
      </header>

      <main className="pb-16">
        <div className="mx-auto max-w-7xl px-4 pt-5 sm:px-5 md:hidden">
          <label className="block w-full">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索文献本"
              className="liquid-glass-input h-11 w-full rounded-lg px-3.5 text-sm"
            />
          </label>
        </div>

        <FeaturedNotebookStrip disabled={!notebooksReady} onOpen={onOpenFeatured} />

        <section className="mx-auto max-w-7xl px-4 py-6 sm:px-5 sm:py-8">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">最近打开</h1>
            <span className="text-sm tabular-nums text-white/60">{filteredNotebooks.length} 个文献本</span>
          </div>

          {filteredNotebooks.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <CreateNotebookCard disabled={!notebooksReady} onCreate={onCreate} />
              {filteredNotebooks.map(notebook => (
                <NotebookCard
                  key={notebook.id}
                  notebook={notebook}
                  active={notebook.id === activeNotebookId}
                  disabled={!notebooksReady}
                  onOpen={() => {
                    if (notebooksReady) onOpen(notebook.id);
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="liquid-glass-inset flex min-h-48 flex-col items-center justify-center rounded-xl px-6 text-center">
              <Search className="h-6 w-6 text-white/40" />
              <p className="mt-3 text-sm font-semibold text-white/80">没有匹配的文献本</p>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="mt-3 rounded-lg px-3 py-2 text-sm font-medium text-blue-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                清除搜索
              </button>
            </div>
          )}
        </section>

        {accountStatus?.configured && !accountSession && (
          <div className="liquid-glass-card mx-auto mt-6 flex max-w-7xl items-center justify-between gap-4 rounded-xl p-4 text-sm text-white/90">
            <div className="flex items-center gap-2">
              <BrandMark compact className="h-7 w-7" />
              登录后可以继续保存和打开你的文献本。
            </div>
            <Link href={`/account?next=${ACCOUNT_NOTEBOOK_NEXT}`} className="font-semibold text-blue-300 underline underline-offset-4">
              去登录
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
