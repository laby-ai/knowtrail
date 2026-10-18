'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Archive,
  LayoutGrid,
  List,
  LogOut,
  Plus,
  RotateCcw,
  Search,
  UserRound,
  X,
} from 'lucide-react';
import { BrandMark } from '@/components/brand/BrandMark';
import type { AccountAuthSession } from '@/lib/account-auth-client';
import {
  ACCOUNT_NOTEBOOK_NEXT,
  type AccountCenterStatus,
  type WorkspaceNotebook,
} from '@/components/home/workspace-types';
import { archivedNotebooks, visibleNotebooks } from '@/lib/notebook-lifecycle';
import {
  CreateNotebookCard,
  FeaturedNotebookStrip,
  NotebookCard,
} from '@/components/home/NotebookCards';
import {
  decodeNotebookHomePreferences,
  encodeNotebookHomePreferences,
  projectNotebookHome,
  type NotebookHomeFilter,
  type NotebookHomeSort,
  type NotebookHomeView,
} from '@/lib/notebook-home-controls';
import { filterFeaturedNotebooks } from '@/components/home/featured-notebooks';

type NotebookHomeProps = {
  embedded: boolean;
  notebooks: WorkspaceNotebook[];
  activeNotebookId: string | null;
  accountStatus: AccountCenterStatus | null;
  accountSession: AccountAuthSession | null;
  notebooksReady: boolean;
  preferencesStorageKey: string;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onOpenFeatured: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
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
  embedded,
  notebooks,
  activeNotebookId,
  accountStatus,
  accountSession,
  notebooksReady,
  preferencesStorageKey,
  onCreate,
  onOpen,
  onOpenFeatured,
  onRename,
  onArchive,
  onRestore,
  onShowLanding,
  onSignOut,
}: NotebookHomeProps) {
  const [query, setQuery] = useState('');
  const [editingNotebook, setEditingNotebook] = useState<WorkspaceNotebook | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [archiveTarget, setArchiveTarget] = useState<WorkspaceNotebook | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState<NotebookHomeFilter>('all');
  const [sort, setSort] = useState<NotebookHomeSort>('latest');
  const [view, setView] = useState<NotebookHomeView>('grid');
  const [restoredPreferencesKey, setRestoredPreferencesKey] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const activeNotebooks = visibleNotebooks(notebooks);
  const archivedItems = archivedNotebooks(notebooks);
  const projection = projectNotebookHome({ notebooks: activeNotebooks, query, filter, sort, view });
  const filteredNotebooks = projection.notebooks;
  const filteredFeaturedNotebooks = filterFeaturedNotebooks(query);
  const filteredArchivedItems = archivedItems.filter(notebook => notebook.title.toLowerCase().includes(normalizedQuery));
  const hasSearchMatches = filteredFeaturedNotebooks.length > 0 || filteredNotebooks.length > 0 || filteredArchivedItems.length > 0;

  useEffect(() => {
    let restored = null;
    try {
      restored = decodeNotebookHomePreferences(window.localStorage.getItem(preferencesStorageKey));
    } catch {
      // Storage can be unavailable in privacy-restricted embeds; defaults remain usable.
    }
    if (restored) {
      setQuery(restored.query);
      setFilter(restored.filter);
      setSort(restored.sort);
      setView(restored.view);
    } else {
      setQuery('');
      setFilter('all');
      setSort('latest');
      setView('grid');
    }
    setRestoredPreferencesKey(preferencesStorageKey);
  }, [preferencesStorageKey]);

  useEffect(() => {
    if (restoredPreferencesKey !== preferencesStorageKey) return;
    try {
      window.localStorage.setItem(preferencesStorageKey, encodeNotebookHomePreferences({ query, filter, sort, view }));
    } catch {
      // Keep the controls usable even when the browser refuses persistent storage.
    }
  }, [filter, preferencesStorageKey, query, restoredPreferencesKey, sort, view]);

  const beginRename = (notebook: WorkspaceNotebook) => {
    setEditingNotebook(notebook);
    setEditingTitle(notebook.title);
  };

  const confirmRename = () => {
    if (!editingNotebook || !editingTitle.trim()) return;
    onRename(editingNotebook.id, editingTitle);
    setEditingNotebook(null);
  };

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 px-4 py-3 backdrop-blur-xl sm:px-5">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          {embedded ? (
            <div className="flex min-w-0 items-center gap-2" data-testid="embedded-notebook-home-title">
              <span className="h-2 w-2 rounded-full bg-[#2866D7]" aria-hidden="true" />
              <span className="truncate text-base font-semibold text-[#142033]">文献工作台</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={onShowLanding}
              className="flex shrink-0 items-center gap-2.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              aria-label="返回 KnowTrail 首页"
            >
              <BrandMark compact />
              <span className="whitespace-nowrap text-xl font-semibold tracking-tight">KnowTrail</span>
            </button>
          )}

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
            {!embedded && (
              <AccountArea accountStatus={accountStatus} accountSession={accountSession} onSignOut={onSignOut} />
            )}
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

        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 pt-5 sm:px-5 md:flex-row md:items-center md:justify-between">
          <div className="inline-flex w-fit rounded-full border border-slate-200 bg-white p-1" role="radiogroup" aria-label="文献本范围">
            {([
              ['all', '全部'],
              ['mine', '我的文献本'],
              ['featured', '精选模板'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={filter === value}
                onClick={() => setFilter(value)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${filter === value ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'}`}
                data-testid={`notebook-home-filter-${value}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="notebook-home-sort">文献本排序</label>
            <select
              id="notebook-home-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as NotebookHomeSort)}
              className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none transition hover:border-slate-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              data-testid="notebook-home-sort"
            >
              <option value="latest">最近更新</option>
              <option value="oldest">最早更新</option>
              <option value="title">按名称</option>
            </select>
            <div className="inline-flex rounded-full border border-slate-200 bg-white p-1" role="radiogroup" aria-label="文献本视图">
              <button type="button" role="radio" aria-checked={view === 'grid'} onClick={() => setView('grid')} className={`flex h-8 w-8 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${view === 'grid' ? 'bg-slate-100 text-slate-950' : 'text-slate-500 hover:text-slate-950'}`} aria-label="网格视图" data-testid="notebook-home-view-grid">
                <LayoutGrid className="pointer-events-none h-4 w-4" />
              </button>
              <button type="button" role="radio" aria-checked={view === 'list'} onClick={() => setView('list')} className={`flex h-8 w-8 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${view === 'list' ? 'bg-slate-100 text-slate-950' : 'text-slate-500 hover:text-slate-950'}`} aria-label="列表视图" data-testid="notebook-home-view-list">
                <List className="pointer-events-none h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {projection.showFeatured && filteredFeaturedNotebooks.length > 0 && (
          <FeaturedNotebookStrip
            disabled={!notebooksReady}
            items={filteredFeaturedNotebooks}
            onOpen={onOpenFeatured}
            view={view === 'list' ? 'list' : 'grid'}
          />
        )}

        {projection.showPersonal && <section className="mx-auto max-w-7xl px-4 py-6 sm:px-5 sm:py-8">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h1 className="text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">最近打开</h1>
            <span className="text-sm tabular-nums text-slate-500">{filteredNotebooks.length} 个文献本</span>
          </div>

          {filteredNotebooks.length > 0 ? (
            <div className={view === 'list' ? 'space-y-2' : 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}>
              {view !== 'list' && <CreateNotebookCard disabled={!notebooksReady} onCreate={onCreate} />}
              {filteredNotebooks.map(notebook => (
                <NotebookCard
                  key={notebook.id}
                  notebook={notebook}
                  active={notebook.id === activeNotebookId}
                  disabled={!notebooksReady}
                  onOpen={() => {
                    if (notebooksReady) onOpen(notebook.id);
                  }}
                  onRename={() => beginRename(notebook)}
                  onArchive={() => setArchiveTarget(notebook)}
                  canArchive={activeNotebooks.length > 1}
                  view={view === 'list' ? 'list' : 'grid'}
                />
              ))}
            </div>
          ) : null}
        </section>}

        {normalizedQuery && !hasSearchMatches && (
          <section className="mx-auto max-w-7xl px-4 py-8 sm:px-5">
            <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 text-center">
              <Search className="h-6 w-6 text-slate-400" />
              <p className="mt-3 text-sm font-semibold text-slate-900">没有匹配的文献本或精选模板</p>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="mt-3 rounded-lg px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                清除搜索
              </button>
            </div>
          </section>
        )}

        {archivedItems.length > 0 && (
          <section className="mx-auto max-w-7xl px-4 pb-8 sm:px-5" data-testid="notebook-home-archived">
            <button
              type="button"
              onClick={() => setShowArchived(open => !open)}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-expanded={showArchived || Boolean(normalizedQuery)}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Archive className="h-4 w-4" /> 已归档
              </span>
              <span className="text-xs text-slate-500">{filteredArchivedItems.length} 个，可随时恢复</span>
            </button>
            {(showArchived || Boolean(normalizedQuery)) && (
              <div className="mt-3 space-y-2">
                {filteredArchivedItems.map(notebook => (
                  <div key={notebook.id} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{notebook.title}</p>
                      <p className="mt-1 text-xs text-slate-500">{notebook.sourceCount} 个来源 · 内容仍保留</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRestore(notebook.id)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> 恢复
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {!embedded && accountStatus?.configured && !accountSession && (
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

      {editingNotebook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm" onClick={() => setEditingNotebook(null)}>
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="rename-notebook-title">
            <div className="flex items-center justify-between gap-3">
              <h2 id="rename-notebook-title" className="text-lg font-semibold text-slate-950">重命名文献本</h2>
              <button type="button" onClick={() => setEditingNotebook(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="关闭重命名">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-600">名称会保留在当前账号空间，来源和问答记录不受影响。</p>
            <input
              value={editingTitle}
              onChange={event => setEditingTitle(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') confirmRename(); }}
              maxLength={60}
              autoFocus
              className="mt-4 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              aria-label="文献本名称"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setEditingNotebook(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">取消</button>
              <button type="button" onClick={confirmRename} disabled={!editingTitle.trim()} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45">保存名称</button>
            </div>
          </div>
        </div>
      )}

      {archiveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm" onClick={() => setArchiveTarget(null)}>
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="archive-notebook-title">
            <h2 id="archive-notebook-title" className="text-lg font-semibold text-slate-950">归档“{archiveTarget.title}”</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">归档只会从最近打开中收起文献本，不删除来源、问答和产物，之后可以在“已归档”中恢复。</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setArchiveTarget(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">取消</button>
              <button type="button" onClick={() => { onArchive(archiveTarget.id); setArchiveTarget(null); setShowArchived(true); }} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">确认归档</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
