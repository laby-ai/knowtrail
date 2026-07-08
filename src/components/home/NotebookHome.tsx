'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Check,
  ChevronDown,
  Grid3X3,
  List,
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
        className="inline-flex h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-slate-300"
        data-testid="notebook-home-account"
      >
        <UserRound className="h-4 w-4" />
        登录账号
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1.5 shadow-sm" data-testid="notebook-home-account">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-800">
        {accountSession.member.display_name.slice(0, 1)}
      </div>
      <div className="hidden min-w-0 md:block">
        <div className="truncate text-sm font-semibold leading-4 text-slate-900">{accountSession.member.display_name}</div>
        <div className="truncate text-xs leading-4 text-slate-500">{accountSession.member.email}</div>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
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
    <div className="min-h-screen bg-white text-slate-950">
      <header className="sticky top-0 z-40 bg-white/92 px-5 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
          <button type="button" onClick={onShowLanding} className="flex items-center gap-3 text-left">
            <BrandMark compact />
            <span className="whitespace-nowrap text-2xl font-semibold tracking-tight">KnowTrail</span>
          </button>

          <div className="hidden flex-1 justify-center px-6 lg:flex">
            <div className="flex items-center gap-2">
              <label className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-600" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索文献本或资料"
                  className="h-12 w-[300px] rounded-full border border-slate-200 bg-white pl-12 pr-4 text-sm outline-none transition placeholder:text-slate-500 focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
                  data-testid="notebook-home-search"
                />
              </label>
              <div className="inline-flex h-12 rounded-full border border-slate-200 bg-white p-1">
                <button className="inline-flex h-10 w-11 items-center justify-center rounded-full bg-[#eef2ff] text-slate-950" aria-label="网格视图">
                  <Check className="h-5 w-5" />
                </button>
                <button className="inline-flex h-10 w-11 items-center justify-center rounded-full text-slate-700 hover:bg-slate-50" aria-label="卡片视图">
                  <Grid3X3 className="h-5 w-5" />
                </button>
                <button className="inline-flex h-10 w-11 items-center justify-center rounded-full text-slate-700 hover:bg-slate-50" aria-label="列表视图">
                  <List className="h-5 w-5" />
                </button>
              </div>
              <button className="inline-flex h-12 items-center gap-2 rounded-full border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                最新
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <AccountArea accountStatus={accountStatus} accountSession={accountSession} onSignOut={onSignOut} />
            <button
              type="button"
              onClick={onCreate}
              disabled={!notebooksReady}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="notebook-home-create"
            >
              <Plus className="h-4 w-4" />
              新建文献本
            </button>
          </div>
        </div>
      </header>

      <main className="pb-20">
        <div className="mx-auto max-w-[1440px] px-5 pt-8">
          <div className="mx-auto mb-9 flex w-fit items-center gap-2 rounded-full bg-white p-1 text-sm font-medium text-slate-600">
            <button className="rounded-full bg-[#eef2ff] px-5 py-3 text-slate-900">全部</button>
            <button className="rounded-full px-5 py-3 hover:bg-slate-50">我的文献本</button>
            <button className="rounded-full px-5 py-3 hover:bg-slate-50">精选文献本</button>
          </div>
        </div>

        <FeaturedNotebookStrip disabled={!notebooksReady} onOpen={onOpenFeatured} />

        <section className="mx-auto max-w-7xl px-5 py-8">
          <div className="mb-5 flex items-end justify-between gap-4">
            <h1 className="text-3xl font-normal tracking-tight text-slate-950">最近打开的文献本</h1>
            <label className="relative w-full max-w-sm lg:hidden">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索文献本"
                className="h-11 w-full rounded-full border border-slate-200 bg-white pl-11 pr-3 text-sm outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
              />
            </label>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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
        </section>

        {accountStatus?.configured && !accountSession && (
          <div className="mx-auto mt-6 flex max-w-7xl items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
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
