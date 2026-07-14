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
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        data-testid="notebook-home-account"
      >
        <UserRound className="h-4 w-4" />
        <span className="hidden sm:inline">登录账号</span>
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white p-1" data-testid="notebook-home-account">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-50 text-sm font-semibold text-blue-800">
        {accountSession.member.display_name.slice(0, 1)}
      </div>
      <div className="hidden min-w-0 md:block">
        <div className="truncate text-sm font-semibold leading-4 text-slate-900">{accountSession.member.display_name}</div>
        <div className="truncate text-xs leading-4 text-slate-500">{accountSession.member.email}</div>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
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
    <div className="min-h-screen bg-[#f6f7f9] text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 px-4 py-3 backdrop-blur-xl sm:px-5">
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

          <label className="relative mx-auto hidden w-full max-w-md md:block">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索文献本"
              className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm outline-none transition placeholder:text-slate-500 hover:border-slate-300 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
              data-testid="notebook-home-search"
            />
          </label>

          <div className="flex items-center gap-2">
            <AccountArea accountStatus={accountStatus} accountSession={accountSession} onSignOut={onSignOut} />
            <button
              type="button"
              onClick={onCreate}
              disabled={!notebooksReady}
              className="inline-flex h-10 w-10 items-center justify-center gap-2 rounded-lg bg-slate-950 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-4"
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
          <label className="relative block w-full">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索文献本"
              className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </label>
        </div>

        <FeaturedNotebookStrip disabled={!notebooksReady} onOpen={onOpenFeatured} />

        <section className="mx-auto max-w-7xl px-4 py-6 sm:px-5 sm:py-8">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h1 className="text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">最近打开</h1>
            <span className="text-sm tabular-nums text-slate-500">{filteredNotebooks.length} 个文献本</span>
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
            <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 text-center">
              <Search className="h-6 w-6 text-slate-400" />
              <p className="mt-3 text-sm font-semibold text-slate-900">没有匹配的文献本</p>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="mt-3 rounded-lg px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                清除搜索
              </button>
            </div>
          )}
        </section>

        {accountStatus?.configured && !accountSession && (
          <div className="mx-auto mt-6 flex max-w-7xl items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <div className="flex items-center gap-2">
              <BrandMark compact className="h-7 w-7" />
              登录后可以继续保存和打开你的文献本。
            </div>
            <Link href={`/account?next=${ACCOUNT_NOTEBOOK_NEXT}`} className="font-semibold underline underline-offset-4">
              去登录
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
