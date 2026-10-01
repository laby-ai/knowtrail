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
  normalizeNotebookTitle,
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
import { readStoredAccountSession } from '@/lib/account-session-browser';

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
  activeNotebookId: _activeNotebookId,
  notebooks: _notebooks,
  accountSession: _accountSession,
  onBackHome: _onBackHome,
  onSignOut: _onSignOut,
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
    <div className="h-screen w-screen overflow-hidden">
      <ThreeColumnLayout
        leftPanel={<LibraryPanel />}
        centerPanel={<EditorPanel />}
        rightPanel={<StudioPanel />}
        defaultLeftWidth={280}
        defaultRightWidth={380}
      />
    </div>
  );
}

export default function HomePage() {
  const [view, setView] = useState<View>('landing');
  const [accountStatus, setAccountStatus] = useState<AccountCenterStatus | null>(null);
  const [accountSession, setAccountSession] = useState<AccountAuthSession | null>(null);
  const [notebooks, setNotebooks] = useState<WorkspaceNotebook[]>(() => createDefaultNotebooks());
  const [activeNotebookId, setActiveNotebookId] = useState<string | null>(null);
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
    } else if (viewParam) {
      setView(viewParam);
    }
  }, []);

  useEffect(() => {
    const loaded = loadNotebooks(accountSession);
    setNotebooks(loaded);
    setActiveNotebookId(loadActiveNotebookId(accountSession));
    setNotebooksReady(true);
  }, [accountSession]);

  const persistNotebooks = useCallback((next: WorkspaceNotebook[]) => {
    setNotebooks(next);
    saveNotebooks(next, accountSession);
  }, [accountSession]);

  const handleOpenNotebookHome = useCallback(() => {
    setView('notebooks');
  }, []);

  const handleCreateNotebook = useCallback(() => {
    const id = `notebook-${Date.now()}`;
    const title = normalizeNotebookTitle('未命名文献本', notebooks.length);
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
    <AppProvider>
      <LiquidGlassProvider>
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
            onCreate={handleCreateNotebook}
            onOpen={handleOpenNotebook}
            onOpenFeatured={handleOpenFeatured}
            onShowLanding={handleShowLanding}
            onSignOut={handleSignOut}
          />
        )}
        {view === 'workspace' && (
          <AcademicPresenterContent
            activeNotebookId={activeNotebookId}
            notebooks={notebooks}
            accountSession={accountSession}
            onBackHome={handleBackToNotebooks}
            onSignOut={handleSignOut}
          />
        )}
      </LiquidGlassProvider>
    </AppProvider>
  );
}
