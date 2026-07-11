'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppProvider } from '@/contexts/AppContext';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { LibraryPanel } from '@/components/library/LibraryPanel';
import { EditorPanel } from '@/components/editor/EditorPanel';
import { StudioPanel } from '@/components/studio/StudioPanel';
import { WorkbenchTopBar } from '@/components/workbench/WorkbenchTopBar';
import { VirtualClassroomWorkspace } from '@/components/studio/VirtualClassroomWorkspace';
import { KnowledgeMapWorkspace } from '@/components/studio/KnowledgeMapWorkspace';
import { LiquidGlassProvider } from '@/components/ui/liquid-glass-provider';
import { useApp } from '@/contexts/AppContext';
import { clearAccountSession, readStoredAccountSession, revokeStoredAccountSession } from '@/lib/account-session-browser';
import type { AccountAuthSession } from '@/lib/account-auth-client';
import { LandingPage } from '@/components/home/LandingPage';
import { NotebookHome } from '@/components/home/NotebookHome';
import {
  ACCOUNT_NOTEBOOK_NEXT,
  ACTIVE_NOTEBOOK_STORAGE_KEY,
  NOTEBOOKS_STORAGE_KEY,
  createDefaultNotebooks,
  normalizeNotebookTitle,
  scopedStorageKey,
  type AccountCenterStatus,
  type WorkspaceNotebook,
} from '@/components/home/workspace-types';
import {
  FEATURED_NOTEBOOKS,
  createFeaturedNotebookFolders,
  featuredNotebookToWorkspace,
  isFeaturedNotebookId,
} from '@/components/home/featured-notebooks';

function WorkbenchCenterPanel() {
  const { virtualClassroomViewer, knowledgeMapViewer } = useApp();
  if (virtualClassroomViewer) return <VirtualClassroomWorkspace />;
  if (knowledgeMapViewer) return <KnowledgeMapWorkspace />;
  return <EditorPanel />;
}

function AcademicPresenterContent({
  workspaceTitle,
  onBackHome,
  onSignOut,
  showSourceGuide,
  onSourceGuideDismiss,
  accountSession,
  accountAuthRequired,
}: {
  workspaceTitle: string;
  onBackHome: () => void;
  onSignOut: () => void;
  showSourceGuide: boolean;
  onSourceGuideDismiss: () => void;
  accountSession: AccountAuthSession | null;
  accountAuthRequired: boolean;
}) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg-primary)]">
      <WorkbenchTopBar
        workspaceTitle={workspaceTitle}
        onBackHome={onBackHome}
        onSignOut={onSignOut}
      />
      <div className="min-h-0 flex-1">
        <ThreeColumnLayout
          leftPanel={(
            <LibraryPanel
              workspaceTitle={workspaceTitle}
              onBackHome={onBackHome}
              accountSession={accountSession}
              accountAuthRequired={accountAuthRequired}
              showSourceGuide={showSourceGuide}
              onSourceGuideDismiss={onSourceGuideDismiss}
            />
          )}
          centerPanel={<WorkbenchCenterPanel />}
          rightPanel={<StudioPanel />}
          defaultLeftWidth={280}
          defaultRightWidth={500}
          initialMobilePanel={showSourceGuide ? 'left' : 'center'}
        />
      </div>
    </div>
  );
}

export default function HomePage() {
  const [entered, setEntered] = useState(false);
  const [showLanding, setShowLanding] = useState(true);
  const [notebooks, setNotebooks] = useState<WorkspaceNotebook[]>([]);
  const [notebooksReady, setNotebooksReady] = useState(false);
  const [activeNotebookId, setActiveNotebookId] = useState<string | null>(null);
  const [showSourceGuide, setShowSourceGuide] = useState(false);
  const [accountStatus, setAccountStatus] = useState<AccountCenterStatus | null>(null);
  const [accountSession, setAccountSession] = useState<AccountAuthSession | null>(null);
  const [accountSessionReady, setAccountSessionReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadAccountSession() {
      const stored = readStoredAccountSession();
      if (!stored) {
        if (!cancelled) {
          setAccountSession(null);
          setAccountSessionReady(true);
        }
        return;
      }
      try {
        const response = await fetch('/api/account/session', {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${stored.token}` },
        });
        if (!response.ok) {
          if (!cancelled) clearAccountSession();
          throw new Error('account session expired');
        }
        const context = await response.json() as Partial<AccountAuthSession>;
        if (!cancelled) {
          setAccountSession({ ...stored, ...context, token: stored.token, expires_at: stored.expires_at });
          setAccountSessionReady(true);
        }
      } catch {
        if (cancelled) return;
        setAccountSession(null);
        setAccountSessionReady(true);
      }
    }
    void loadAccountSession();
    const onSessionChange = () => { void loadAccountSession(); };
    window.addEventListener('knowtrail-account-session-changed', onSessionChange);
    return () => {
      cancelled = true;
      window.removeEventListener('knowtrail-account-session-changed', onSessionChange);
    };
  }, []);

  useEffect(() => {
    if (!accountSessionReady) return;
    setNotebooksReady(false);
    try {
      const saved = window.localStorage.getItem(scopedStorageKey(NOTEBOOKS_STORAGE_KEY, accountSession));
      const parsed = saved ? JSON.parse(saved) as WorkspaceNotebook[] : null;
      const nextNotebooks = (Array.isArray(parsed) && parsed.length > 0 ? parsed : createDefaultNotebooks())
        .map((notebook, index) => ({ ...notebook, title: normalizeNotebookTitle(notebook.title, index) }));
      const savedActive = window.localStorage.getItem(scopedStorageKey(ACTIVE_NOTEBOOK_STORAGE_KEY, accountSession));
      setNotebooks(nextNotebooks);
      setActiveNotebookId(savedActive && nextNotebooks.some(item => item.id === savedActive) ? savedActive : nextNotebooks[0]?.id || null);
      setNotebooksReady(true);
    } catch {
      const defaults = createDefaultNotebooks();
      setNotebooks(defaults);
      setActiveNotebookId(defaults[0]?.id || null);
      setNotebooksReady(true);
    }
  }, [accountSession, accountSessionReady]);

  useEffect(() => {
    if (!accountSessionReady || notebooks.length === 0) return;
    try {
      window.localStorage.setItem(scopedStorageKey(NOTEBOOKS_STORAGE_KEY, accountSession), JSON.stringify(notebooks));
      if (activeNotebookId) window.localStorage.setItem(scopedStorageKey(ACTIVE_NOTEBOOK_STORAGE_KEY, accountSession), activeNotebookId);
    } catch {
      // Keep the interface usable in restricted browser storage modes.
    }
  }, [accountSession, accountSessionReady, activeNotebookId, notebooks]);

  useEffect(() => {
    let cancelled = false;
    async function loadAccountStatus() {
      try {
        const response = await fetch('/api/account/status', { cache: 'no-store' });
        if (!response.ok) return;
        const status = await response.json() as AccountCenterStatus;
        if (!cancelled) setAccountStatus(status);
      } catch {
        if (!cancelled) setAccountStatus(null);
      }
    }
    void loadAccountStatus();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (entered || showLanding || !accountSessionReady) return;
    if (!accountStatus) return;
    const accountHeaders: Record<string, string> = accountSession?.token ? { Authorization: `Bearer ${accountSession.token}` } : {};
    if (accountStatus.authRequired && !accountHeaders.Authorization) return;
    let cancelled = false;
    async function syncDefaultSourceCount() {
      try {
        const response = await fetch('/api/ingestion/sources?notebookId=default-workspace', {
          cache: 'no-store',
          headers: accountHeaders,
        });
        if (!response.ok) return;
        const data = await response.json() as { sources?: unknown[] };
        const sourceCount = Array.isArray(data.sources) ? data.sources.length : 0;
        if (cancelled || sourceCount <= 0) return;
        setNotebooks(prev => {
          const current = prev.length > 0 ? prev : createDefaultNotebooks();
          return current.map(notebook => (
            notebook.id === 'default-workspace'
              ? { ...notebook, sourceCount }
              : notebook
          ));
        });
      } catch {
        // Keep notebook home usable even if the source store is unavailable.
      }
    }
    void syncDefaultSourceCount();
    return () => { cancelled = true; };
  }, [accountSession, accountSessionReady, accountStatus, entered, showLanding]);

  useEffect(() => {
    const applyRouteState = () => {
      const params = new URLSearchParams(window.location.search);
      const isWorkbenchRoute =
        window.location.hash === '#workbench' ||
        params.get('view') === 'workbench';

      if (isWorkbenchRoute) {
        setShowLanding(false);
        setEntered(true);
        return;
      }

      if (window.location.hash === '#notebooks' || params.get('view') === 'notebooks') {
        setShowLanding(false);
        setEntered(false);
        return;
      }

      if (params.get('view') === 'landing') {
        setShowLanding(true);
        setEntered(false);
        return;
      }

      if (!window.location.hash && !window.location.search) {
        setShowLanding(true);
        setEntered(false);
      }
    };

    applyRouteState();
    window.addEventListener('hashchange', applyRouteState);
    window.addEventListener('popstate', applyRouteState);
    return () => {
      window.removeEventListener('hashchange', applyRouteState);
      window.removeEventListener('popstate', applyRouteState);
    };
  }, []);

  const accountAuthRequired = accountStatus?.authRequired === true;
  const requiresAccountSignIn = accountAuthRequired && accountSessionReady && !accountSession;
  const redirectToAccount = useCallback(() => {
    window.location.replace(`/account?next=${ACCOUNT_NOTEBOOK_NEXT}`);
  }, []);

  useEffect(() => {
    if (!requiresAccountSignIn) return;
    if (entered || !showLanding) redirectToAccount();
  }, [entered, redirectToAccount, requiresAccountSignIn, showLanding]);

  const enterWorkbench = (notebookId = activeNotebookId) => {
    if (!notebooksReady) return;
    if (requiresAccountSignIn) {
      redirectToAccount();
      return;
    }
    if (notebookId) {
      setActiveNotebookId(notebookId);
      setNotebooks(prev => prev.map(notebook => (
        notebook.id === notebookId ? { ...notebook, updatedAt: new Date().toISOString() } : notebook
      )));
    }
    setShowLanding(false);
    setEntered(true);

    const nextUrl = `${window.location.pathname}?view=workbench#workbench`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) {
      window.history.replaceState(null, '', nextUrl);
    }
  };

  const createNotebook = () => {
    if (!accountSessionReady || !notebooksReady) return;
    if (requiresAccountSignIn) {
      redirectToAccount();
      return;
    }
    const id = `workspace-${Date.now()}`;
    const nextNotebook: WorkspaceNotebook = {
      id,
      title: notebooks.length === 0 ? '未命名工作本' : `未命名工作本 ${notebooks.length + 1}`,
      sourceCount: 0,
      updatedAt: new Date().toISOString(),
      accent: ['from-cyan-50 via-white to-blue-50', 'from-violet-50 via-white to-sky-50', 'from-emerald-50 via-white to-teal-50'][notebooks.length % 3],
    };
    setNotebooks(prev => [nextNotebook, ...prev]);
    setShowSourceGuide(true);
    enterWorkbench(id);
  };

  const openNotebook = (id: string) => {
    if (!notebooksReady) return;
    if (requiresAccountSignIn) {
      redirectToAccount();
      return;
    }
    enterWorkbench(id);
  };

  const openFeaturedNotebook = (id: string) => {
    if (!notebooksReady) return;
    if (requiresAccountSignIn) {
      redirectToAccount();
      return;
    }
    const featured = FEATURED_NOTEBOOKS.find(item => item.id === id);
    if (!featured) return;
    const workspaceNotebook = featuredNotebookToWorkspace(featured);
    setNotebooks(prev => {
      const withoutExisting = prev.filter(notebook => notebook.id !== id);
      return [{ ...workspaceNotebook, updatedAt: new Date().toISOString() }, ...withoutExisting];
    });
    setShowSourceGuide(false);
    enterWorkbench(id);
  };

  const openNotebookHome = () => {
    if (requiresAccountSignIn) {
      redirectToAccount();
      return;
    }
    setEntered(false);
    setShowLanding(false);
    const nextUrl = `${window.location.pathname}?view=notebooks`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) {
      window.history.replaceState(null, '', nextUrl);
    }
  };

  const signOut = async () => {
    try {
      await revokeStoredAccountSession();
      setAccountSession(null);
      setAccountSessionReady(true);
      window.location.href = `/account?next=${ACCOUNT_NOTEBOOK_NEXT}`;
    } catch {
      window.alert('暂时无法安全退出，请检查网络后重试。');
    }
  };

  const activeNotebook = notebooks.find(notebook => notebook.id === activeNotebookId) || notebooks[0] || createDefaultNotebooks()[0];
  const workbenchScopeKey = `${accountSession?.member.id || 'guest'}:${activeNotebook.id}`;
  const featuredFolders = useMemo(
    () => createFeaturedNotebookFolders(activeNotebook.id),
    [activeNotebook.id],
  );
  const featuredSelectedPaperIds = useMemo(
    () => featuredFolders.flatMap(folder => folder.papers.map(paper => paper.id)),
    [featuredFolders],
  );

  return (
    <AppProvider
      key={workbenchScopeKey}
      storageScopeKey={workbenchScopeKey}
      initialFolders={isFeaturedNotebookId(activeNotebook.id) ? featuredFolders : []}
      initialSelectedPaperIds={isFeaturedNotebookId(activeNotebook.id) ? featuredSelectedPaperIds : []}
    >
      <LiquidGlassProvider>
        {entered ? (
          <AcademicPresenterContent
            workspaceTitle={activeNotebook.title}
            onBackHome={openNotebookHome}
            onSignOut={signOut}
            showSourceGuide={showSourceGuide}
            onSourceGuideDismiss={() => setShowSourceGuide(false)}
            accountSession={accountSession}
            accountAuthRequired={accountStatus?.authRequired !== false}
          />
        ) : showLanding ? (
          <LandingPage
            accountStatus={accountStatus}
            accountSession={accountSession}
            onOpenNotebookHome={openNotebookHome}
          />
        ) : (
          <NotebookHome
            notebooks={notebooks.length > 0 ? notebooks : createDefaultNotebooks()}
            activeNotebookId={activeNotebookId}
            accountStatus={accountStatus}
            accountSession={accountSession}
            notebooksReady={notebooksReady}
            onCreate={createNotebook}
            onOpen={openNotebook}
            onOpenFeatured={openFeaturedNotebook}
            onShowLanding={() => {
              setShowLanding(true);
              window.history.replaceState(null, '', window.location.pathname);
            }}
            onSignOut={signOut}
          />
        )}
      </LiquidGlassProvider>
    </AppProvider>
  );
}
