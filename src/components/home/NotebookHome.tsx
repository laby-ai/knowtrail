'use client';

import { UiText, useUiText } from '@/components/account/UiText';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ResearchSky } from '@/components/home/ResearchSky';
import {
  Search,
  UserRound,
} from 'lucide-react';
import { BrandMark } from '@/components/brand/BrandMark';
import { AccountSettingsButton } from '@/components/account/AccountSettingsButton';
import type { AccountAuthSession } from '@/lib/account-auth-client';
import {
  ACCOUNT_NOTEBOOK_NEXT,
  type AccountCenterStatus,
  type WorkspaceNotebook,
} from '@/components/home/workspace-types';
import {
  CreateNotebookCard,
  NotebookCard,
} from '@/components/home/NotebookCards';
import { ThemeToggle } from '@/components/ui/theme-toggle';

type NotebookHomeProps = {
  notebooks: WorkspaceNotebook[];
  activeNotebookId: string | null;
  accountStatus: AccountCenterStatus | null;
  accountSession: AccountAuthSession | null;
  notebooksReady: boolean;
  sharingEntry?: ReactNode;
  onCreate: () => void;
  onOpen: (id: string) => void;
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
        <span className="hidden sm:inline"><UiText>登录账号</UiText></span>
      </Link>
    );
  }

  return <AccountSettingsButton session={accountSession} onSignOut={onSignOut} />;

}

export function NotebookHome({
  notebooks,
  activeNotebookId,
  accountStatus,
  accountSession,
  notebooksReady,
  sharingEntry,
  onCreate,
  onOpen,
  onShowLanding,
  onSignOut,
}: NotebookHomeProps) {
  const t = useUiText();
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const filteredNotebooks = notebooks.filter(notebook => notebook.title.toLowerCase().includes(normalizedQuery));

  return (
    <div className="notebook-home-page relative isolate min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/20 px-4 py-3 backdrop-blur-xl sm:px-5">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
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
              placeholder={t('搜索文献本')}
              className="liquid-glass-input h-10 w-full rounded-lg px-3.5 text-sm"
              data-testid="notebook-home-search"
            />
          </label>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <AccountArea accountStatus={accountStatus} accountSession={accountSession} onSignOut={onSignOut} />
            {sharingEntry}
          </div>
        </div>
      </header>

      <ResearchSky variant="notebooks" />
      <main className="relative pb-16">
        <div className="mx-auto max-w-7xl px-4 pt-5 sm:px-5 md:hidden">
          <label className="block w-full">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('搜索文献本')}
              className="liquid-glass-input h-11 w-full rounded-lg px-3.5 text-sm"
            />
          </label>
        </div>

        <section className="mx-auto max-w-7xl px-4 py-6 sm:px-5 sm:py-8">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl"><UiText>最近打开</UiText></h1>
            <span className="text-sm tabular-nums text-white/60">{filteredNotebooks.length} <UiText>个文献本</UiText></span>
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
              <p className="mt-3 text-sm font-semibold text-white/80">{!notebooksReady ? '正在加载文献本…' : query ? '没有匹配的文献本' : '还没有文献本'}</p>
              <button
                type="button"
                disabled={!notebooksReady} onClick={() => query ? setQuery('') : onCreate()}
                className="mt-3 rounded-lg px-3 py-2 text-sm font-medium text-blue-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                {query ? '清除搜索' : '新建文献本'}
              </button>
            </div>
          )}
        </section>

        {accountStatus?.configured && !accountSession && (
          <div className="liquid-glass-card mx-auto mt-6 flex max-w-7xl items-center justify-between gap-4 rounded-xl p-4 text-sm text-white/90">
            <div className="flex items-center gap-2">
              <BrandMark compact className="h-7 w-7" /><UiText>
              登录后可以继续保存和打开你的文献本。
            </UiText></div>
            <Link href={`/account?next=${ACCOUNT_NOTEBOOK_NEXT}`} className="font-semibold text-blue-300 underline underline-offset-4"><UiText>
              去登录
            </UiText></Link>
          </div>
        )}
      </main>
    </div>
  );
}
