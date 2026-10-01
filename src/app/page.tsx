'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppProvider } from '@/contexts/AppContext';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { LibraryPanel } from '@/components/library/LibraryPanel';
import { EditorPanel } from '@/components/editor/EditorPanel';
import { StudioPanel } from '@/components/studio/StudioPanel';
import { LiquidGlassProvider } from '@/components/ui/liquid-glass-provider';
import { LandingPage } from '@/components/home/LandingPage';
import { NotebookHome } from '@/components/home/NotebookHome';
import {
  createDefaultNotebooks,
  scopedStorageKey,
  NOTEBOOKS_STORAGE_KEY,
  ACTIVE_NOTEBOOK_STORAGE_KEY,
  type WorkspaceNotebook,
  type AccountCenterStatus,
} from '@/components/home/workspace-types';
import {
  FEATURED_NOTEBOOKS,
  isFeaturedNotebookId,
  featuredNotebookToWorkspace,
  createFeaturedNotebookFolders,
} from '@/components/home/featured-notebooks';
import type { AccountAuthSession } from '@/lib/account-auth-client';
import { clearAccountSession, readStoredAccountSession } from '@/lib/account-session-browser';

import { CreateNotebookDialog } from '@/components/home/CreateNotebookDialog';

type View = 'landing' | 'notebooks' | 'workspace';

function loadNotebooks(session: AccountAuthSession | null): WorkspaceNotebook[] {
  if (typeof window === 'undefined') return createDefaultNotebooks();
  try {
    const raw = window.localStorage.getItem(scopedStorageKey(NOTEBOOKS_STORAGE_KEY, session));
    if (!raw) return createDefaultNotebooks();
    const parsed = JSON.parse(raw) as WorkspaceNotebook[];
    if (!Array.isArray(parsed) || parsed.length === 0) return createDefaultNotebooks();
    return parsed;
  } catch {
    return createDefaultNotebooks();
  }
}

function saveNotebooks(notebooks: WorkspaceNotebook[], session: AccountAuthSession | null) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(scopedStorageKey(NOTEBOOKS_STORAGE_KEY, session), JSON.stringify(notebooks));
  } catch { /* quota */ }
}

function loadActiveNotebookId(session: AccountAuthSession | null): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(scopedStorageKey(ACTIVE_NOTEBOOK_STORAGE_KEY, session));
  } catch {
    return null;
  }
}

function saveActiveNotebookId(id: string | null, session: AccountAuthSession | null) {
  if (typeof window === 'undefined') return;
  try {
    const key = scopedStorageKey(ACTIVE_NOTEBOOK_STORAGE_KEY, session);
    if (id) window.localStorage.setItem(key, id);
    else window.localStorage.removeItem(key);
  } catch { /* quota */ }
}

function AcademicPresenterContent({
  activeNotebookId,
  notebooks,
  onBackHome,
}: {
  activeNotebookId: string | null;
  notebooks: WorkspaceNotebook[];
  accountSession: AccountAuthSession | null;
  onBackHome: () => void;
  onSignOut: () => void;
}) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div className="h-dvh w-full min-w-0 overflow-hidden flex flex-col">
      <header className="flex shrink-0 items-center gap-4 border-b border-[var(--border-subtle)] px-4 py-2">
        <button type="button" onClick={onBackHome} className="shrink-0 text-sm text-blue-500">返回文献本</button>
        <h1 className="min-w-0 truncate text-sm font-semibold">{notebooks.find(n => n.id === activeNotebookId)?.title}</h1>
      </header>
      <div className="min-h-0 flex-1">
      <ThreeColumnLayout
        leftPanel={<LibraryPanel />}
        centerPanel={<EditorPanel />}
        rightPanel={<StudioPanel />}
        defaultLeftWidth={320}
        defaultRightWidth={380}
      />
      </div>
    </div>
  );
}

export default function HomePage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<View>('landing');
  const [accountStatus, setAccountStatus] = useState<AccountCenterStatus | null>(null);
  const [accountSession, setAccountSession] = useState<AccountAuthSession | null>(null);
  const [notebooks, setNotebooks] = useState<WorkspaceNotebook[]>(() => createDefaultNotebooks());
  const [activeNotebookId, setActiveNotebookId] = useState<string | null>(null);
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [notebooksReady, setNotebooksReady] = useState(false);

  useEffect(() => {
    fetch('/api/account/status')
      .then(res => res.json())
      .then(data => setAccountStatus(data))
      .catch(() => setAccountStatus(null));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view') as View | null;
    const storedSession = readStoredAccountSession();
    if (storedSession) {
      setAccountSession(storedSession);
      if (viewParam === 'workspace' || viewParam === 'notebooks') {
        setView(viewParam);
      } else {
        setView('notebooks');
      }
    } else if (viewParam === 'workspace' || viewParam === 'notebooks') {
      setView(viewParam);
    }
    setSessionReady(true);
    const refreshSession = () => setAccountSession(readStoredAccountSession());
    window.addEventListener('knowtrail-account-session-changed', refreshSession);
    window.addEventListener('storage', refreshSession);
    return () => { window.removeEventListener('knowtrail-account-session-changed', refreshSession); window.removeEventListener('storage', refreshSession); };
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    const loaded = loadNotebooks(accountSession);
    setNotebooks(loaded);
    const storedId = loadActiveNotebookId(accountSession);
    setActiveNotebookId(loaded.some(n => n.id === storedId) ? storedId : loaded[0]?.id ?? null);
    setLoadedOwner(accountSession?.member.id || 'guest');
    setNotebooksReady(true);
  }, [accountSession, sessionReady]);

  const persistNotebooks = useCallback((next: WorkspaceNotebook[]) => {
    setNotebooks(next);
    saveNotebooks(next, accountSession);
  }, [accountSession]);

  const handleOpenNotebookHome = useCallback(() => {
    setView('notebooks');
  }, []);

  const handleCreateNotebook = useCallback((name: string) => {
    const title = name.trim();
    if (!title || title.length > 80) return;
    const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const id = `notebook-${randomId}`;
    setCreateOpen(false);
    const now = new Date().toISOString();
    const accents = [
      'from-sky-50 via-white to-cyan-50',
      'from-rose-50 via-white to-pink-50',
      'from-emerald-50 via-white to-teal-50',
      'from-violet-50 via-white to-purple-50',
      'from-amber-50 via-white to-orange-50',
    ];
    const accent = accents[notebooks.length % accents.length];
    const newNotebook: WorkspaceNotebook = {
      id,
      title,
      sourceCount: 0,
      updatedAt: now,
      accent,
    };
    const next = [newNotebook, ...notebooks];
    persistNotebooks(next);
    setActiveNotebookId(id);
    saveActiveNotebookId(id, accountSession);
    setView('workspace');
  }, [notebooks, persistNotebooks, accountSession]);

  const handleOpenNotebook = useCallback((id: string) => {
    setActiveNotebookId(id);
    saveActiveNotebookId(id, accountSession);
    const notebook = notebooks.find(n => n.id === id);
    if (notebook) {
      const now = new Date().toISOString();
      const updated = notebooks.map(n => n.id === id ? { ...n, updatedAt: now } : n);
      persistNotebooks(updated);
    }
    setView('workspace');
  }, [notebooks, persistNotebooks, accountSession]);

  const handleOpenFeatured = useCallback((id: string) => {
    if (!isFeaturedNotebookId(id)) return;
    const featured = FEATURED_NOTEBOOKS.find(n => n.id === id);
    if (!featured) return;

    const existing = notebooks.find(n => n.id === id);
    if (existing) {
      setActiveNotebookId(id);
      saveActiveNotebookId(id, accountSession);
      setView('workspace');
      return;
    }

    const wsNotebook = featuredNotebookToWorkspace(featured);
    const next = [wsNotebook, ...notebooks];
    persistNotebooks(next);
    setActiveNotebookId(id);
    saveActiveNotebookId(id, accountSession);

    const folders = createFeaturedNotebookFolders(id);
    if (folders.length > 0) {
      try {
        window.localStorage.setItem(
          scopedStorageKey(`lingbi-folders:${id}`, accountSession),
          JSON.stringify(folders),
        );
      } catch { /* quota */ }
    }

    setView('workspace');
  }, [notebooks, persistNotebooks, accountSession]);

  const handleShowLanding = useCallback(() => {
    setView('landing');
  }, []);

  const handleBackToNotebooks = useCallback(() => {
    setView('notebooks');
  }, []);

  const handleSignOut = useCallback(async () => {
    clearAccountSession();
    setAccountSession(null);
    setNotebooks(createDefaultNotebooks());
    setActiveNotebookId(null);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(scopedStorageKey(NOTEBOOKS_STORAGE_KEY, null));
        window.localStorage.removeItem(scopedStorageKey(ACTIVE_NOTEBOOK_STORAGE_KEY, null));
      } catch { /* ignore */ }
    }
    setView('landing');
  }, []);

  return (
    <LiquidGlassProvider>
      <CreateNotebookDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreateNotebook} />
        {view === 'landing' && (
          <LandingPage
            accountStatus={accountStatus}
            accountSession={accountSession}
            onOpenNotebookHome={handleOpenNotebookHome}
          />
        )}
        {view === 'notebooks' && (
          <NotebookHome
            notebooks={notebooks}
            activeNotebookId={activeNotebookId}
            accountStatus={accountStatus}
            accountSession={accountSession}
            notebooksReady={notebooksReady}
            onCreate={() => setCreateOpen(true)}
            onOpen={handleOpenNotebook}
            onOpenFeatured={handleOpenFeatured}
            onShowLanding={handleShowLanding}
            onSignOut={handleSignOut}
          />
        )}
        {view === 'workspace' && notebooksReady && loadedOwner === (accountSession?.member.id || 'guest') && activeNotebookId && (
          <AppProvider
            key={`${accountSession?.member.id || 'guest'}:${activeNotebookId}`}
            storageScopeKey={`${accountSession?.member.id || 'guest'}:${activeNotebookId}`}
            initialFolders={isFeaturedNotebookId(activeNotebookId) ? createFeaturedNotebookFolders(activeNotebookId) : []}
          >
          <AcademicPresenterContent
            activeNotebookId={activeNotebookId}
            notebooks={notebooks}
            accountSession={accountSession}
            onBackHome={handleBackToNotebooks}
            onSignOut={handleSignOut}
          />
          </AppProvider>
        )}
    </LiquidGlassProvider>
  );
}
