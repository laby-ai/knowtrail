'use client';
import { checkedApiFetch } from '@/lib/api-response';

import { clientApiRequest } from '@/lib/client-api';
import { useState, useEffect, useCallback } from 'react';
import { AppProvider } from '@/contexts/AppContext';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { LibraryPanel } from '@/components/library/LibraryPanel';
import { EditorPanel } from '@/components/editor/EditorPanel';
import { StudioPanel } from '@/components/studio/StudioPanel';
import { LiquidGlassProvider } from '@/components/ui/liquid-glass-provider';
import { LandingPage } from '@/components/home/LandingPage';
import { NotebookHome } from '@/components/home/NotebookHome';
import { ResearchSky } from '@/components/home/ResearchSky';
import { AccountSettingsButton } from '@/components/account/AccountSettingsButton';
import { ResearchPreferencesProvider, ResearchModeButton } from '@/components/research/ResearchPreferencesProvider';
import { ResearchCollaboration } from '@/components/research/ResearchCollaboration';
import { ResearchWorkspacePanel } from '@/components/research/ResearchWorkspacePanel';
import {
  createDefaultNotebooks,
  scopedStorageKey,
  NOTEBOOKS_STORAGE_KEY,
  ACTIVE_NOTEBOOK_STORAGE_KEY,
  type WorkspaceNotebook,
  type AccountCenterStatus,
} from '@/components/home/workspace-types';
import type { AccountAuthSession } from '@/lib/account-auth-client';
import { accountAuthHeaders, clearAccountSession, readStoredAccountSession } from '@/lib/account-session-browser';

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
  accountSession,
  onSignOut,
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
    <div className="relative isolate h-dvh w-full min-w-0 overflow-hidden flex flex-col">
      <ResearchSky variant="workspace" />
      <header className="flex shrink-0 items-center gap-4 border-b border-[var(--border-subtle)] px-4 py-2">
        <button type="button" onClick={onBackHome} className="shrink-0 text-sm text-blue-500">返回文献本</button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{notebooks.find(n => n.id === activeNotebookId)?.title}</h1>
        {accountSession && <ResearchModeButton />}
        {accountSession && <ResearchCollaboration />}
        {accountSession && <ResearchWorkspacePanel />}
        {accountSession && <AccountSettingsButton session={accountSession} onSignOut={onSignOut} />}
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
  const [notebookError, setNotebookError] = useState('');
  const [reloadNotebooks, setReloadNotebooks] = useState(0);

  useEffect(() => {
    checkedApiFetch('/api/account/status')
      .then(res => res.json())
      .then(data => setAccountStatus(data))
      .catch(() => setAccountStatus(null));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view');
    const storedSession = readStoredAccountSession();
    setAccountSession(storedSession);
    // Restoring a session must not skip the public home page.
    setView(viewParam === 'workspace' || viewParam === 'notebooks' ? viewParam : 'landing');
    setSessionReady(true);
    const refreshSession = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== null
        && event.key !== 'knowtrail-account-session'
        && event.key !== 'account_entitlement_token') return;
      const next = readStoredAccountSession();
      setAccountSession(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    window.addEventListener('knowtrail-account-session-changed', refreshSession);
    window.addEventListener('storage', refreshSession);
    return () => { window.removeEventListener('knowtrail-account-session-changed', refreshSession); window.removeEventListener('storage', refreshSession); };
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    const controller = new AbortController();
    setNotebooksReady(false);
    setNotebookError('');
    const owner = accountSession?.member.id || 'guest';
    async function load() {
      try {
        // Preserve locally created notebooks; never import bundled templates or a fabricated default.
        const legacy = (accountSession?.member.id === 'account-center-token' ? [] : loadNotebooks(accountSession)).filter(item => item.id !== 'default-workspace' && !item.id.startsWith('featured-'));
        const response = await clientApiRequest('/api/notebooks', {
          method: legacy.length ? 'POST' : 'GET', signal: controller.signal, cache: 'no-store',
          headers: { ...accountAuthHeaders(), 'Content-Type': 'application/json' },
          ...(legacy.length ? { body: JSON.stringify({ notebooks: legacy.map(({id, title}) => ({id, title})), onlyMissing: true }) } : {}),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '无法加载文献本');
        if (controller.signal.aborted) return;
        const loaded: WorkspaceNotebook[] = result.notebooks;
        setNotebooks(loaded);
        saveNotebooks(loaded, accountSession);
        const storedId = loadActiveNotebookId(accountSession);
        setActiveNotebookId(loaded.some(n => n.id === storedId) ? storedId : loaded[0]?.id ?? null);
        setLoadedOwner(owner);
        setNotebooksReady(true);
      } catch (error) {
        if (!controller.signal.aborted) { setNotebooks([]); setNotebookError(error instanceof Error ? error.message : '无法加载文献本'); }
      }
    }
    void load();
    return () => controller.abort();
  }, [accountSession, sessionReady, view, reloadNotebooks]);

  const persistNotebooks = useCallback(async (next: WorkspaceNotebook[]) => {
    let stored: WorkspaceNotebook[] = [];
    const entries = next.map(({ id, title }) => ({ id, title }));
    for (let offset = 0; offset < entries.length; offset += 500) {
      const response = await clientApiRequest('/api/notebooks', { method: 'POST', headers: { ...accountAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ notebooks: entries.slice(offset, offset + 500) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '保存文献本失败');
      stored = result.notebooks;
    }
    setNotebooks(stored);
    saveNotebooks(stored, accountSession);
  }, [accountSession]);

  const handleOpenNotebookHome = useCallback(() => {
    setView('notebooks');
  }, []);

  const handleCreateNotebook = useCallback(async (name: string) => {
    const title = name.trim();
    if (!title || title.length > 80) return;
    const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const id = `notebook-${randomId}`;
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
    await persistNotebooks([newNotebook]);
    setCreateOpen(false);
    setActiveNotebookId(id);
    saveActiveNotebookId(id, accountSession);
    setView('workspace');
  }, [notebooks, persistNotebooks, accountSession]);

  const handleOpenNotebook = useCallback((id: string) => {
    setActiveNotebookId(id);
    saveActiveNotebookId(id, accountSession);
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
        {view === 'notebooks' && notebookError && <div role="alert" className="p-4 text-red-600">{notebookError}<button className="ml-3 underline" onClick={() => setReloadNotebooks(value => value + 1)}>重试</button></div>}
        {view === 'notebooks' && (
          <NotebookHome
            sharingEntry={accountSession ? (
              <AppProvider key={`shared-entry:${accountSession.tenant_id}:${accountSession.member.id}`} storageScopeKey={`${accountSession.member.id}:shared-entry`} initialFolders={[]}>
                <ResearchCollaboration sharedOnly />
              </AppProvider>
            ) : null}
            notebooks={notebooks}
            activeNotebookId={activeNotebookId}
            accountStatus={accountStatus}
            accountSession={accountSession}
            notebooksReady={notebooksReady}
            onCreate={() => setCreateOpen(true)}
            onOpen={handleOpenNotebook}
            onShowLanding={handleShowLanding}
            onSignOut={handleSignOut}
          />
        )}
        {view === 'workspace' && notebooksReady && loadedOwner === (accountSession?.member.id || 'guest') && activeNotebookId && (
          <AppProvider
            key={`${accountSession?.member.id || 'guest'}:${activeNotebookId}`}
            storageScopeKey={`${accountSession?.member.id || 'guest'}:${activeNotebookId}`}
            initialFolders={[]}
          >
          <ResearchPreferencesProvider ownerId={accountSession?.member.id}>
          <AcademicPresenterContent
            activeNotebookId={activeNotebookId}
            notebooks={notebooks}
            accountSession={accountSession}
            onBackHome={handleBackToNotebooks}
            onSignOut={handleSignOut}
          />
          </ResearchPreferencesProvider>
          </AppProvider>
        )}
    </LiquidGlassProvider>
  );
}
