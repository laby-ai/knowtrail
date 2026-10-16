'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppProvider } from '@/contexts/AppContext';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { LibraryPanel } from '@/components/library/LibraryPanel';
import { EditorPanel } from '@/components/editor/EditorPanel';
import {
  ACTIVE_TOOL_STORAGE_KEY,
  StudioPanel,
} from '@/components/studio/StudioPanel';
import {
  StudioToolSwitcher,
  getVisibleStudioNav,
  shouldHideVirtualClassroom,
  type StudioTab,
} from '@/components/studio/StudioToolSwitcher';
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
  type AccountCenterStatus,
  type WorkbenchPreferences,
  type WorkspaceNotebook,
} from '@/components/home/workspace-types';
import {
  FEATURED_NOTEBOOKS,
  createFeaturedNotebookFolders,
  featuredNotebookToWorkspace,
  featuredTemplateId,
} from '@/components/home/featured-notebooks';
import {
  installPaperHostBridge,
  paperHostScopePrefix,
  readPaperHostContext,
  type PaperHostContext,
} from '@/lib/paper-host-bridge';
import { resolveEmbeddedEntryState } from '@/lib/embedded-entry-state';
import { loadNotebookSourceCounts, mergeNotebookSourceCounts } from '@/lib/notebook-source-counts';
import { clientApiFetch, clientApiPath } from '@/lib/client-api';
import {
  archiveNotebook,
  renameNotebook,
  restoreNotebook,
  visibleNotebooks,
} from '@/lib/notebook-lifecycle';

const FEATURED_SOURCE_COUNTS = Object.fromEntries(
  FEATURED_NOTEBOOKS.map(notebook => [notebook.id, notebook.sourceCount]),
);

function WorkbenchCenterPanel({
  compact,
}: {
  compact: boolean;
}) {
  const { virtualClassroomViewer, knowledgeMapViewer } = useApp();
  if (virtualClassroomViewer) return <VirtualClassroomWorkspace />;
  if (knowledgeMapViewer) return <KnowledgeMapWorkspace />;
  return <EditorPanel compact={compact} />;
}

function AcademicPresenterContent({
  workspaceTitle,
  onBackHome,
  onSignOut,
  showSourceGuide,
  onSourceGuideDismiss,
  accountSession,
  accountAuthRequired,
  paperHostContext,
  templateCopy,
  storageScopeKey,
  workbenchPreferences,
  onWorkbenchPreferencesChange,
}: {
  workspaceTitle: string;
  onBackHome: () => void;
  onSignOut: () => void;
  showSourceGuide: boolean;
  onSourceGuideDismiss: () => void;
  accountSession: AccountAuthSession | null;
  accountAuthRequired: boolean;
  paperHostContext: PaperHostContext;
  templateCopy: boolean;
  storageScopeKey: string;
  workbenchPreferences: WorkbenchPreferences;
  onWorkbenchPreferencesChange: (preferences: Partial<WorkbenchPreferences>) => void;
}) {
  const quiet = paperHostContext.enabled;
  const [studioOpen, setStudioOpen] = useState(false);
  const activeToolStorageKey = `${ACTIVE_TOOL_STORAGE_KEY}:${storageScopeKey}`;
  const [activeStudioTab, setActiveStudioTab] = useState<StudioTab | null>(() => {
    const visibleTools = getVisibleStudioNav(shouldHideVirtualClassroom());
    if (
      workbenchPreferences.activeStudioTool
      && visibleTools.some(item => item.id === workbenchPreferences.activeStudioTool)
    ) {
      return workbenchPreferences.activeStudioTool as StudioTab;
    }
    return null;
  });

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    if (activeStudioTab) return;
    const visibleTools = getVisibleStudioNav(shouldHideVirtualClassroom());
    const savedTab = window.sessionStorage.getItem(activeToolStorageKey);
    if (savedTab && visibleTools.some(item => item.id === savedTab)) {
      setActiveStudioTab(savedTab as StudioTab);
    }
  }, [activeStudioTab, activeToolStorageKey]);

  function openStudioWorkspace(tab: StudioTab) {
    setStudioOpen(true);
    setActiveStudioTab(tab);
    window.sessionStorage.setItem(activeToolStorageKey, tab);
    onWorkbenchPreferencesChange({ activeStudioTool: tab });
  }

  function closeStudioWorkspace() {
    if (quiet) { setStudioOpen(false); return; }
    setActiveStudioTab(null);
    window.sessionStorage.removeItem(activeToolStorageKey);
    onWorkbenchPreferencesChange({ activeStudioTool: null });
  }

  return (
    <div className={`flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg-primary)] ${quiet ? 'quiet-research-workbench' : ''}`}>
      <WorkbenchTopBar
        workspaceTitle={workspaceTitle}
        onBackHome={onBackHome}
        onSignOut={onSignOut}
        embedded={quiet}
        authenticated={Boolean(accountSession)}
        templateCopy={templateCopy}
      />
      <div className="min-h-0 flex-1 quiet-enter">
        <ThreeColumnLayout
          leftPanel={(
            <LibraryPanel
              compact={quiet}
              workspaceTitle={workspaceTitle}
              onBackHome={onBackHome}
              accountSession={accountSession}
              accountAuthRequired={accountAuthRequired}
              showSourceGuide={showSourceGuide}
              onSourceGuideDismiss={onSourceGuideDismiss}
            />
          )}
          centerPanel={(
            <WorkbenchCenterPanel
              compact={quiet}
            />
          )}
          rightPanel={(
            <StudioPanel
              compact={quiet}
              activeTab={activeStudioTab}
              onSelect={openStudioWorkspace}
              onClose={closeStudioWorkspace}
            />
          )}
          rightRail={quiet ? (
            <StudioToolSwitcher
              rail
              navItems={getVisibleStudioNav(true)}
              activeTab={studioOpen ? activeStudioTab : null}
              onSelect={tab => {
                if (studioOpen && tab === activeStudioTab) closeStudioWorkspace();
                else openStudioWorkspace(tab);
              }}
            />
          ) : undefined}
          rightOpen={studioOpen}
          onCloseRight={closeStudioWorkspace}
          appearance={quiet ? 'quiet-research' : 'glass'}
          defaultLeftWidth={quiet ? 272 : 280}
          defaultRightWidth={quiet ? 440 : 500}
          initialMobilePanel={showSourceGuide ? 'left' : 'center'}
          rightFocusKey={activeStudioTab}
          storageScopeKey={storageScopeKey}
          initialPreferences={workbenchPreferences}
          onPreferencesChange={onWorkbenchPreferencesChange}
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
  const [notebooksStorageOwner, setNotebooksStorageOwner] = useState<string | null>(null);
  const [activeNotebookId, setActiveNotebookId] = useState<string | null>(null);
  const [workbenchPreferences, setWorkbenchPreferences] = useState<WorkbenchPreferences>({});
  const [showSourceGuide, setShowSourceGuide] = useState(false);
  const [accountStatus, setAccountStatus] = useState<AccountCenterStatus | null>(null);
  const [accountSession, setAccountSession] = useState<AccountAuthSession | null>(null);
  const [accountSessionReady, setAccountSessionReady] = useState(false);
  const [routeReady, setRouteReady] = useState(false);
  const [paperHostContext, setPaperHostContext] = useState<PaperHostContext>(() => ({
    enabled: false,
    workspaceKey: '',
    accountScope: '',
    embedAuthMode: '',
    hostBridgeVersion: '',
  }));
  const hostScopePrefix = paperHostScopePrefix(paperHostContext);
  const notebookStorageOwner = paperHostContext.enabled
    ? hostScopePrefix || 'paper-host:login-required'
    : accountSession?.member.id || 'guest';
  const accountNotebookPersistence = paperHostContext.enabled
    ? paperHostContext.accountScope === 'current-user'
    : Boolean(accountSession);
  const notebookStorageKey = useCallback(
    (base: string) => `${base}:${notebookStorageOwner}`,
    [notebookStorageOwner],
  );
  const notebookIdsSignature = notebooks.map(notebook => notebook.id).join('|');

  useEffect(() => {
    const context = readPaperHostContext();
    if (!context.enabled) return undefined;
    return installPaperHostBridge();
  }, []);

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
        const response = await fetch(clientApiPath('/api/account/session'), {
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
    let cancelled = false;
    setNotebooksReady(false);
    async function loadNotebooks() {
      if (accountNotebookPersistence) {
        try {
          const response = await clientApiFetch<{
            catalog: {
              notebooks: WorkspaceNotebook[];
              activeNotebookId: string | null;
              workbenchPreferences?: WorkbenchPreferences;
            } | null;
          }>('/api/notebooks', { redirectOnUnauthorized: false });
          if (cancelled) return;
          if (response.catalog?.notebooks.length) {
            const nextNotebooks = response.catalog.notebooks
              .map((notebook, index) => ({ ...notebook, title: normalizeNotebookTitle(notebook.title, index) }));
            const availableNotebooks = visibleNotebooks(nextNotebooks);
            setNotebooks(nextNotebooks);
            setActiveNotebookId(
              response.catalog.activeNotebookId
              && availableNotebooks.some(item => item.id === response.catalog?.activeNotebookId)
                ? response.catalog.activeNotebookId
                : availableNotebooks[0]?.id || null,
            );
            setWorkbenchPreferences(response.catalog.workbenchPreferences || {});
            setNotebooksStorageOwner(notebookStorageOwner);
            setNotebooksReady(true);
            return;
          }
        } catch {
          // Fall back to this browser's account-scoped copy while sync recovers.
        }
      }
      try {
        const saved = window.localStorage.getItem(notebookStorageKey(NOTEBOOKS_STORAGE_KEY));
        const parsed = saved ? JSON.parse(saved) as WorkspaceNotebook[] : null;
        const nextNotebooks = (Array.isArray(parsed) && parsed.length > 0 ? parsed : createDefaultNotebooks())
          .map((notebook, index) => ({ ...notebook, title: normalizeNotebookTitle(notebook.title, index) }));
        const savedActive = window.localStorage.getItem(notebookStorageKey(ACTIVE_NOTEBOOK_STORAGE_KEY));
        const savedPreferences = window.localStorage.getItem(notebookStorageKey('knowtrail-workbench-preferences'));
        if (cancelled) return;
        setNotebooks(nextNotebooks);
        setWorkbenchPreferences(savedPreferences ? JSON.parse(savedPreferences) as WorkbenchPreferences : {});
        const availableNotebooks = visibleNotebooks(nextNotebooks);
        setActiveNotebookId(savedActive && availableNotebooks.some(item => item.id === savedActive) ? savedActive : availableNotebooks[0]?.id || null);
        setNotebooksStorageOwner(notebookStorageOwner);
        setNotebooksReady(true);
      } catch {
        if (cancelled) return;
        const defaults = createDefaultNotebooks();
        setNotebooks(defaults);
        setActiveNotebookId(defaults[0]?.id || null);
        setWorkbenchPreferences({});
        setNotebooksStorageOwner(notebookStorageOwner);
        setNotebooksReady(true);
      }
    }
    void loadNotebooks();
    return () => { cancelled = true; };
  }, [accountNotebookPersistence, accountSessionReady, notebookStorageKey, notebookStorageOwner]);

  useEffect(() => {
    if (
      !accountSessionReady
      || !notebooksReady
      || notebooksStorageOwner !== notebookStorageOwner
      || notebooks.length === 0
    ) return;
    try {
      window.localStorage.setItem(notebookStorageKey(NOTEBOOKS_STORAGE_KEY), JSON.stringify(notebooks));
      if (activeNotebookId) window.localStorage.setItem(notebookStorageKey(ACTIVE_NOTEBOOK_STORAGE_KEY), activeNotebookId);
      window.localStorage.setItem(notebookStorageKey('knowtrail-workbench-preferences'), JSON.stringify(workbenchPreferences));
    } catch {
      // Keep the interface usable in restricted browser storage modes.
    }
    if (accountNotebookPersistence) {
      void clientApiFetch('/api/notebooks', {
        method: 'PUT',
        redirectOnUnauthorized: false,
        body: JSON.stringify({ notebooks, activeNotebookId, workbenchPreferences }),
      }).catch(() => {
        // The browser copy remains available while account sync recovers.
      });
    }
  }, [accountNotebookPersistence, accountSessionReady, activeNotebookId, notebookStorageKey, notebookStorageOwner, notebooks, notebooksReady, notebooksStorageOwner, workbenchPreferences]);

  const updateWorkbenchPreferences = useCallback((preferences: Partial<WorkbenchPreferences>) => {
    setWorkbenchPreferences(current => ({ ...current, ...preferences }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadAccountStatus() {
      try {
        const response = await fetch(clientApiPath('/api/account/status'), { cache: 'no-store' });
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
    async function syncNotebookSourceCounts() {
      const persistedCounts = await loadNotebookSourceCounts({
        notebookIds: notebookIdsSignature
          ? notebookIdsSignature.split('|')
          : createDefaultNotebooks().map(notebook => notebook.id),
        headers: accountHeaders,
      });
      if (cancelled) return;
      setNotebooks(prev => mergeNotebookSourceCounts({
        notebooks: prev.length > 0 ? prev : createDefaultNotebooks(),
        persistedCounts,
        builtInCounts: FEATURED_SOURCE_COUNTS,
      }));
    }
    void syncNotebookSourceCounts();
    return () => { cancelled = true; };
  }, [accountSession, accountSessionReady, accountStatus, entered, notebookIdsSignature, showLanding]);

  useEffect(() => {
    const applyRouteState = () => {
      const context = readPaperHostContext();
      const route = resolveEmbeddedEntryState({
        search: window.location.search,
        hash: window.location.hash,
      });
      if (
        context.enabled && context.workspaceKey
        && new URLSearchParams(window.location.search).get('embed') === 'research-agent'
        && !route.notebookId
        && window.sessionStorage.getItem(`knowtrail-entry-view:${paperHostScopePrefix(context)}`) === 'notebooks'
      ) {
        route.view = 'notebooks';
      }
      setPaperHostContext(context);
      if (route.notebookId) setActiveNotebookId(route.notebookId);
      setShowLanding(route.view === 'landing');
      setEntered(route.view === 'workbench');
      setRouteReady(true);
    };

    applyRouteState();
    window.addEventListener('hashchange', applyRouteState);
    window.addEventListener('popstate', applyRouteState);
    return () => {
      window.removeEventListener('hashchange', applyRouteState);
      window.removeEventListener('popstate', applyRouteState);
    };
  }, []);

  const paperHostSignInRequired = paperHostContext.enabled && !paperHostContext.workspaceKey;
  const accountAuthRequired = !paperHostContext.enabled && accountStatus?.authRequired === true;
  const requiresAccountSignIn = accountAuthRequired && accountSessionReady && !accountSession;
  const interactionBlocked = requiresAccountSignIn || paperHostSignInRequired;
  const redirectToAccount = useCallback(() => {
    window.location.replace(`/account?next=${ACCOUNT_NOTEBOOK_NEXT}`);
  }, []);

  useEffect(() => {
    if (!requiresAccountSignIn) return;
    if (entered || !showLanding) redirectToAccount();
  }, [entered, redirectToAccount, requiresAccountSignIn, showLanding]);

  const enterWorkbench = (notebookId = activeNotebookId) => {
    if (!notebooksReady) return;
    if (paperHostSignInRequired) return;
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

    const params = new URLSearchParams(window.location.search);
    params.set('view', 'workbench');
    if (notebookId) params.set('notebookId', notebookId);
    if (paperHostContext.enabled && paperHostContext.workspaceKey && params.get('embed') === 'research-agent') {
      window.sessionStorage.removeItem(notebookStorageKey('knowtrail-entry-view'));
    }
    const nextUrl = `${window.location.pathname}?${params.toString()}#workbench`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) {
      window.history.replaceState(null, '', nextUrl);
    }
  };

  const createNotebook = () => {
    if (!accountSessionReady || !notebooksReady) return;
    if (interactionBlocked) {
      if (paperHostSignInRequired) return;
      redirectToAccount();
      return;
    }
    const id = `workspace-${Date.now()}`;
    const nextNotebook: WorkspaceNotebook = {
      id,
      title: visibleNotebooks(notebooks).length === 0 ? '未命名文献本' : `未命名文献本 ${visibleNotebooks(notebooks).length + 1}`,
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
    if (interactionBlocked) {
      if (paperHostSignInRequired) return;
      redirectToAccount();
      return;
    }
    enterWorkbench(id);
  };

  const renameWorkspaceNotebook = (id: string, title: string) => {
    setNotebooks(prev => renameNotebook(prev, id, title));
  };

  const archiveWorkspaceNotebook = (id: string) => {
    const nextNotebooks = archiveNotebook(notebooks, id);
    if (nextNotebooks === notebooks) return;
    setNotebooks(nextNotebooks);
    if (activeNotebookId === id) {
      setActiveNotebookId(visibleNotebooks(nextNotebooks)[0]?.id || null);
    }
  };

  const restoreWorkspaceNotebook = (id: string) => {
    setNotebooks(prev => restoreNotebook(prev, id));
  };

  const openFeaturedNotebook = (id: string) => {
    if (!notebooksReady) return;
    if (interactionBlocked) {
      if (paperHostSignInRequired) return;
      redirectToAccount();
      return;
    }
    const featured = FEATURED_NOTEBOOKS.find(item => item.id === id);
    if (!featured) return;
    const copyId = `template-copy-${featured.id}-${Date.now()}`;
    const workspaceNotebook = featuredNotebookToWorkspace(featured, copyId);
    setNotebooks(prev => [{ ...workspaceNotebook, updatedAt: new Date().toISOString() }, ...prev]);
    setShowSourceGuide(false);
    enterWorkbench(copyId);
  };

  const openNotebookHome = () => {
    if (interactionBlocked) {
      if (paperHostSignInRequired) return;
      redirectToAccount();
      return;
    }
    setEntered(false);
    setShowLanding(false);
    const params = new URLSearchParams(window.location.search);
    params.set('view', 'notebooks');
    params.delete('notebookId');
    if (paperHostContext.enabled && paperHostContext.workspaceKey && params.get('embed') === 'research-agent') {
      window.sessionStorage.setItem(notebookStorageKey('knowtrail-entry-view'), 'notebooks');
    }
    const nextUrl = `${window.location.pathname}?${params.toString()}`;
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

  const activeNotebook = visibleNotebooks(notebooks).find(notebook => notebook.id === activeNotebookId)
    || visibleNotebooks(notebooks)[0]
    || createDefaultNotebooks()[0];
  const activeTemplateId = featuredTemplateId(activeNotebook);
  const workbenchScopeKey = `${notebookStorageOwner}:${activeNotebook.id}`;
  const featuredFolders = useMemo(
    () => createFeaturedNotebookFolders(activeTemplateId),
    [activeTemplateId],
  );
  const featuredSelectedPaperIds = useMemo(
    () => featuredFolders.flatMap(folder => folder.papers.map(paper => paper.id)),
    [featuredFolders],
  );

  if (!routeReady || !notebooksReady || notebooksStorageOwner !== notebookStorageOwner) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-[#F7F9FC] text-sm text-slate-500"
        data-testid="embedded-entry-boot-shell"
        aria-busy="true"
        aria-label="正在恢复文献本"
      >
        正在恢复文献本…
      </div>
    );
  }

  return (
    <AppProvider
      key={workbenchScopeKey}
      storageScopeKey={workbenchScopeKey}
      initialFolders={activeTemplateId ? featuredFolders : []}
      initialSelectedPaperIds={activeTemplateId ? featuredSelectedPaperIds : []}
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
            accountAuthRequired={accountAuthRequired}
            paperHostContext={paperHostContext}
            templateCopy={Boolean(activeTemplateId)}
            storageScopeKey={notebookStorageOwner}
            workbenchPreferences={workbenchPreferences}
            onWorkbenchPreferencesChange={updateWorkbenchPreferences}
          />
        ) : showLanding ? (
          <LandingPage
            accountStatus={accountStatus}
            accountSession={accountSession}
            onOpenNotebookHome={openNotebookHome}
          />
        ) : (
          <NotebookHome
            embedded={paperHostContext.enabled}
            notebooks={notebooks.length > 0 ? notebooks : createDefaultNotebooks()}
            activeNotebookId={activeNotebookId}
            accountStatus={accountStatus}
            accountSession={accountSession}
            notebooksReady={notebooksReady}
            preferencesStorageKey={notebookStorageKey('knowtrail-notebook-home-preferences')}
            onCreate={createNotebook}
            onOpen={openNotebook}
            onOpenFeatured={openFeaturedNotebook}
            onRename={renameWorkspaceNotebook}
            onArchive={archiveWorkspaceNotebook}
            onRestore={restoreWorkspaceNotebook}
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
