# Embedded Quiet Research Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the paper-host embedded KnowTrail experience open directly into a refined, brand-neutral research workspace with a quiet three-column layout, while preserving standalone branding and every host/data isolation contract.

**Architecture:** Add one pure entry-state resolver so the first meaningful render is chosen before any landing page is shown. Pass an explicit embedded/quiet appearance down to the notebook home, top bar, editor, studio, and three-column shell; scope all new visual tokens under one Quiet Research root class so standalone KnowTrail remains unchanged. Keep paper-web responsible for the host guest notice and KnowTrail responsible for iframe content.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind CSS 4, Playwright, Node `assert`, Vue 2 paper-web host shell, Jest.

## Global Constraints

- Use pnpm only in the KnowTrail tree; do not use npm or yarn there.
- Embedded paper-host entry must never show the marketing landing page or KnowTrail branding on its first meaningful frame.
- Standalone root entry must retain the marketing landing page and KnowTrail branding.
- Default embedded desktop widths are 272px / flexible center / 420px, with no page-level horizontal overflow.
- Motion durations stay within 160–260ms and must respect `prefers-reduced-motion: reduce`.
- Guest workspace/account isolation, paper-host `postMessage`, `hideVirtualClassroom`, route/return behavior, source persistence, and high-cost authentication configuration must not change.
- No paid AI call is permitted in automated health or UI verification.
- New responsibility-focused modules stay below 400 lines.
- KnowTrail changes remain local audit commits unless upstream push authorization is granted; paper-web changes may only be pushed to `research/platform-upgrade` after all gates pass.

---

## File Map

### KnowTrail audit tree

- Create `src/lib/embedded-entry-state.ts`: pure query/hash to initial view resolution.
- Create `scripts/test-embedded-entry-state.ts`: executable unit contract for entry resolution.
- Create `scripts/smoke-embedded-quiet-workbench.mjs`: local Playwright behavior and layout contract without AI calls.
- Create `src/styles/quiet-research-workbench.css`: embedded-only Quiet Research tokens, separators, density, focus, and reduced-motion rules.
- Modify `src/app/page.tsx`: boot shell, route resolver integration, embedded appearance propagation, 272/420 widths.
- Modify `src/components/home/NotebookHome.tsx`: embedded brand-neutral header and no duplicate account banner.
- Modify `src/components/workbench/WorkbenchTopBar.tsx`: embedded brand-neutral compact status bar.
- Modify `src/components/layout/ThreeColumnLayout.tsx`: quiet appearance, semantic keyboard-operable dividers, test hooks.
- Modify `src/components/editor/EditorPanel.tsx`: compact empty-state question set in embedded mode.
- Modify `src/components/studio/StudioPanel.tsx`: compact embedded product-center shell.
- Modify `src/components/studio/StudioToolSwitcher.tsx`: compact tool-card density.
- Modify `src/app/globals.css`: import the embedded-only stylesheet.
- Modify `package.json`: expose the two new test/smoke commands and include the unit contract in `validate`.

### paper-web Research tree

- Modify `src/components/common/EmbedAccountNotice.vue`: turn the guest notice into a small non-blocking status chip.
- Create `test/unit/specs/embedAccountNotice.spec.js`: lock the guest notice data contract and compact mode hook.

---

### Task 1: Resolve the embedded first frame before rendering content

**Files:**
- Create: `src/lib/embedded-entry-state.ts`
- Create: `scripts/test-embedded-entry-state.ts`
- Modify: `src/app/page.tsx:103-285`
- Modify: `package.json:scripts`

**Interfaces:**
- Produces: `resolveEmbeddedEntryState(input: { search: string; hash: string }): EmbeddedEntryState`.
- Produces: `EmbeddedEntryState = { view: 'landing' | 'notebooks' | 'workbench'; embedded: boolean; notebookId: string | null }`.
- Consumed by: `src/app/page.tsx` initial mount, `hashchange`, and `popstate` handlers.

- [ ] **Step 1: Write the pure entry-state RED contract**

Create `scripts/test-embedded-entry-state.ts`:

```ts
import assert from 'node:assert/strict';
import { resolveEmbeddedEntryState } from '@/lib/embedded-entry-state';

const embeddedBase = 'host=paper-web&hostBridge=postMessage&workspaceKey=guest-session-01';

assert.deepEqual(
  resolveEmbeddedEntryState({ search: `?${embeddedBase}&view=notebooks`, hash: '#notebooks' }),
  { view: 'notebooks', embedded: true, notebookId: null },
);
assert.deepEqual(
  resolveEmbeddedEntryState({ search: `?${embeddedBase}`, hash: '' }),
  { view: 'notebooks', embedded: true, notebookId: null },
);
assert.deepEqual(
  resolveEmbeddedEntryState({ search: `?${embeddedBase}&view=landing`, hash: '' }),
  { view: 'notebooks', embedded: true, notebookId: null },
);
assert.deepEqual(
  resolveEmbeddedEntryState({ search: `?${embeddedBase}&view=workbench&notebookId=workspace-42`, hash: '#workbench' }),
  { view: 'workbench', embedded: true, notebookId: 'workspace-42' },
);
assert.deepEqual(
  resolveEmbeddedEntryState({ search: '', hash: '' }),
  { view: 'landing', embedded: false, notebookId: null },
);
assert.deepEqual(
  resolveEmbeddedEntryState({ search: '?view=notebooks', hash: '#notebooks' }),
  { view: 'notebooks', embedded: false, notebookId: null },
);

console.log('embedded entry state contract passed');
```

- [ ] **Step 2: Run the entry-state test and verify RED**

Run:

```powershell
pnpm exec tsx scripts/test-embedded-entry-state.ts
```

Expected: FAIL with `Cannot find module '@/lib/embedded-entry-state'`.

- [ ] **Step 3: Implement the pure resolver**

Create `src/lib/embedded-entry-state.ts`:

```ts
import { normalizeNotebookId } from '@/lib/notebook-scope';

export type EmbeddedEntryView = 'landing' | 'notebooks' | 'workbench';

export type EmbeddedEntryState = {
  view: EmbeddedEntryView;
  embedded: boolean;
  notebookId: string | null;
};

export function resolveEmbeddedEntryState({
  search,
  hash,
}: {
  search: string;
  hash: string;
}): EmbeddedEntryState {
  const params = new URLSearchParams(search);
  const embedded = params.get('host') === 'paper-web' && params.get('hostBridge') === 'postMessage';
  const requestedView = params.get('view');
  const workbenchRequested = hash === '#workbench' || requestedView === 'workbench';

  if (workbenchRequested) {
    return {
      view: 'workbench',
      embedded,
      notebookId: normalizeNotebookId(params.get('notebookId')),
    };
  }

  if (embedded || hash === '#notebooks' || requestedView === 'notebooks') {
    return { view: 'notebooks', embedded, notebookId: null };
  }

  return { view: 'landing', embedded: false, notebookId: null };
}
```

- [ ] **Step 4: Integrate a neutral boot shell and reuse the resolver for navigation events**

In `src/app/page.tsx`, import the resolver, add `routeReady`, and replace the duplicated URL parsing effect:

```tsx
import { resolveEmbeddedEntryState } from '@/lib/embedded-entry-state';

const [routeReady, setRouteReady] = useState(false);

useEffect(() => {
  const applyRouteState = () => {
    const context = readPaperHostContext();
    const route = resolveEmbeddedEntryState({
      search: window.location.search,
      hash: window.location.hash,
    });
    setPaperHostContext(context);
    if (route.notebookId) setActiveNotebookId(route.notebookId);
    setEntered(route.view === 'workbench');
    setShowLanding(route.view === 'landing');
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

if (!routeReady) {
  return (
    <div
      className="min-h-screen bg-[#F7F9FC]"
      data-testid="embedded-entry-boot-shell"
      aria-busy="true"
      aria-label="正在准备科研工作区"
    />
  );
}
```

Keep `installPaperHostBridge()` in its own effect, but remove its duplicate `setPaperHostContext(context)` assignment so the route effect owns initial context resolution.

- [ ] **Step 5: Add the command and verify GREEN**

Add to `package.json`:

```json
"test:embedded-entry-state": "tsx ./scripts/test-embedded-entry-state.ts"
```

Insert `pnpm test:embedded-entry-state &&` before `pnpm test:paper-platform-adapter` in `validate`.

Run:

```powershell
pnpm test:embedded-entry-state
pnpm test:paper-platform-adapter
pnpm ts-check
```

Expected: all three commands exit 0; the new test prints `embedded entry state contract passed`.

- [ ] **Step 6: Commit the first independently reviewable behavior change**

```powershell
git add package.json src/app/page.tsx src/lib/embedded-entry-state.ts scripts/test-embedded-entry-state.ts
git diff --cached --check
git commit -m "fix(embed): resolve the initial workspace view"
```

---

### Task 2: Remove embedded branding while preserving standalone identity

**Files:**
- Modify: `src/app/page.tsx:45-101,420-458`
- Modify: `src/components/home/NotebookHome.tsx:15-205`
- Modify: `src/components/workbench/WorkbenchTopBar.tsx:1-59`
- Create: `scripts/smoke-embedded-quiet-workbench.mjs`
- Modify: `package.json:scripts`

**Interfaces:**
- Consumes: `paperHostContext.enabled` from Task 1.
- Produces: `NotebookHome.embedded: boolean`.
- Produces: `WorkbenchTopBar.embedded: boolean` and `WorkbenchTopBar.authenticated: boolean`.
- Produces: Playwright smoke command `pnpm smoke:embedded-quiet-workbench`.

- [ ] **Step 1: Write the browser RED for first-frame and brand boundaries**

Create `scripts/smoke-embedded-quiet-workbench.mjs` with a local no-AI app runner and these assertions:

```js
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => typeof address === 'object' && address
        ? resolve(address.port)
        : reject(new Error('No smoke port available.')));
    });
  });
}

function stop(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

async function waitForHealth(origin, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Smoke app exited with ${child.exitCode}.`);
    try {
      const response = await fetch(`${origin}/api/health`, { cache: 'no-store' });
      if (response.ok && (await response.json()).ok === true) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Smoke app health timed out.');
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'quiet-workbench-'));
const port = await findFreePort();
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['scripts/dev.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    DEPLOY_RUN_PORT: String(port),
    SOURCE_STORE_PATH: path.join(tempDir, 'sources.json'),
    ZVEC_STORE_PATH: path.join(tempDir, 'zvec'),
    INTERNAL_APP_ORIGIN: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: false,
});

let browser;
try {
  await waitForHealth(origin, child);
  browser = await chromium.launch({ headless: true });

  const embedded = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await embedded.addInitScript(() => {
    window.__quietSeen = [];
    const record = () => {
      const text = document.body?.innerText || '';
      for (const value of ['开启科研模式', 'KnowTrail']) {
        if (text.includes(value) && !window.__quietSeen.includes(value)) window.__quietSeen.push(value);
      }
    };
    new MutationObserver(record).observe(document.documentElement, { childList: true, subtree: true });
  });
  const query = new URLSearchParams({
    host: 'paper-web',
    hostBridge: 'postMessage',
    workspaceKey: 'guest-session-quiet-01',
    accountScope: 'guest',
    embed: 'research-agent',
    hideVirtualClassroom: '1',
    view: 'notebooks',
  });
  await embedded.goto(`${origin}/?${query}#notebooks`, { waitUntil: 'networkidle' });
  await embedded.getByTestId('notebook-home-create').waitFor({ state: 'visible' });
  assert((await embedded.evaluate(() => window.__quietSeen)).length === 0, 'Embedded entry exposed marketing or KnowTrail branding.');

  const standalone = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await standalone.goto(origin, { waitUntil: 'networkidle' });
  await standalone.getByText('KnowTrail', { exact: true }).first().waitFor({ state: 'visible' });
  await standalone.getByText('开启科研模式', { exact: true }).waitFor({ state: 'visible' });

  await embedded.getByTestId('notebook-home-create').click();
  await embedded.getByTestId('workbench-topbar-title').waitFor({ state: 'visible' });
  assert(await embedded.getByText('KnowTrail', { exact: true }).count() === 0, 'Embedded workbench exposed KnowTrail branding.');

  console.log(JSON.stringify({ ok: true, checked: ['no embedded landing flash', 'no embedded brand', 'standalone brand retained'] }));
} finally {
  await browser?.close().catch(() => undefined);
  stop(child);
  await rm(tempDir, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run the smoke and verify RED**

Run:

```powershell
pnpm exec node scripts/smoke-embedded-quiet-workbench.mjs
```

Expected: FAIL because the mutation history records `KnowTrail` and the workbench top bar still renders `BrandMark`.

- [ ] **Step 3: Add explicit embedded brand props**

Update `NotebookHomeProps` and the header in `src/components/home/NotebookHome.tsx`:

```tsx
type NotebookHomeProps = {
  embedded: boolean;
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
```

Render `AccountArea` and the bottom standalone login banner only when `!embedded`.

Update `WorkbenchTopBarProps` and its identity/status area:

```tsx
type WorkbenchTopBarProps = {
  workspaceTitle: string;
  onBackHome: () => void;
  onSignOut: () => void;
  embedded: boolean;
  authenticated: boolean;
};

{!embedded && <BrandMark compact className="hidden h-9 w-9 border-[var(--border-subtle)] shadow-none sm:block" />}
<span className="hidden rounded-full border border-[#D9E5F8] bg-[#EDF4FF] px-2 py-0.5 text-[10px] font-semibold text-[#2866D7] sm:inline-flex">
  {authenticated ? '账号已同步' : '会话隔离'}
</span>
{authenticated && (
  <button type="button" onClick={onSignOut} data-testid="workbench-topbar-sign-out" aria-label="退出当前账号">
    <LogOut className="h-4 w-4" />
  </button>
)}
```

- [ ] **Step 4: Pass the explicit flags from the page**

In `src/app/page.tsx`:

```tsx
<WorkbenchTopBar
  workspaceTitle={workspaceTitle}
  onBackHome={onBackHome}
  onSignOut={onSignOut}
  embedded={paperHostContext.enabled}
  authenticated={Boolean(accountSession)}
/>

<NotebookHome
  embedded={paperHostContext.enabled}
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
```

Add `paperHostContext: PaperHostContext` to `AcademicPresenterContent` props so the top bar receives the same resolved host context instead of reading URL state again.

- [ ] **Step 5: Add and run the browser command**

Add to `package.json`:

```json
"smoke:embedded-quiet-workbench": "node ./scripts/smoke-embedded-quiet-workbench.mjs"
```

Run:

```powershell
pnpm test:embedded-entry-state
pnpm smoke:embedded-quiet-workbench
pnpm test:notebook-home-usability
pnpm ts-check
```

Expected: PASS; the smoke prints all three checked brand/entry behaviors.

- [ ] **Step 6: Commit the brand boundary**

```powershell
git add package.json scripts/smoke-embedded-quiet-workbench.mjs src/app/page.tsx src/components/home/NotebookHome.tsx src/components/workbench/WorkbenchTopBar.tsx
git diff --cached --check
git commit -m "fix(embed): keep host workspaces brand neutral"
```

---

### Task 3: Implement the quiet three-column shell and accessible separators

**Files:**
- Create: `src/styles/quiet-research-workbench.css`
- Modify: `src/app/globals.css:1-7`
- Modify: `src/app/page.tsx:45-101`
- Modify: `src/components/layout/ThreeColumnLayout.tsx:1-213`
- Modify: `src/components/workbench/WorkbenchTopBar.tsx:15-59`
- Modify: `scripts/smoke-embedded-quiet-workbench.mjs`

**Interfaces:**
- Produces: `ThreeColumnLayout.appearance?: 'glass' | 'quiet-research'`.
- Produces test hooks: `workbench-left-panel`, `workbench-center-panel`, `workbench-right-panel`, `workbench-divider-left`, `workbench-divider-right`.
- Consumed by: `AcademicPresenterContent` with `appearance="quiet-research"` only for paper-host embed.

- [ ] **Step 1: Extend the smoke with layout and keyboard RED assertions**

After opening the workbench in `scripts/smoke-embedded-quiet-workbench.mjs`, add:

```js
const left = embedded.getByTestId('workbench-left-panel');
const center = embedded.getByTestId('workbench-center-panel');
const right = embedded.getByTestId('workbench-right-panel');
const leftBox = await left.boundingBox();
const rightBox = await right.boundingBox();
assert(leftBox && Math.abs(leftBox.width - 272) <= 2, `Expected 272px left panel, got ${leftBox?.width}.`);
assert(rightBox && Math.abs(rightBox.width - 420) <= 2, `Expected 420px right panel, got ${rightBox?.width}.`);
assert(await center.isVisible(), 'Center panel is not visible.');
assert(await embedded.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth), 'Workbench has page-level horizontal overflow.');

const divider = embedded.getByTestId('workbench-divider-left');
await divider.focus();
const before = (await left.boundingBox()).width;
await divider.press('ArrowRight');
const after = (await left.boundingBox()).width;
assert(after > before, 'Keyboard resize did not increase the left panel width.');

await embedded.emulateMedia({ reducedMotion: 'reduce' });
const duration = await embedded.getByTestId('workbench-center-panel').evaluate(node => getComputedStyle(node).transitionDuration);
assert(duration === '0s', `Reduced-motion transition remained ${duration}.`);
```

- [ ] **Step 2: Run the smoke and verify RED**

Run:

```powershell
pnpm smoke:embedded-quiet-workbench
```

Expected: FAIL because the existing page uses 280/500 widths and non-focusable `div` separators.

- [ ] **Step 3: Add the quiet appearance and semantic divider behavior**

In `src/components/layout/ThreeColumnLayout.tsx`, extend props and add one shared keyboard handler:

```tsx
interface ThreeColumnLayoutProps {
  leftPanel: React.ReactNode;
  centerPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  defaultLeftWidth?: number;
  defaultRightWidth?: number;
  initialMobilePanel?: 'left' | 'center' | 'right';
  appearance?: 'glass' | 'quiet-research';
}

const resizeFromKeyboard = useCallback((side: 'left' | 'right', delta: number) => {
  if (side === 'left') setLeftWidth(width => Math.max(220, Math.min(450, width + delta)));
  else setRightWidth(width => Math.max(360, Math.min(680, width + delta)));
}, []);

const handleDividerKeyDown = (side: 'left' | 'right', event: React.KeyboardEvent<HTMLDivElement>) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const direction = event.key === 'ArrowRight' ? 1 : -1;
  resizeFromKeyboard(side, side === 'left' ? direction * 16 : direction * -16);
};
```

Render each separator with:

```tsx
<div
  role="separator"
  aria-orientation="vertical"
  aria-label="调整资料栏宽度"
  aria-valuenow={leftWidth}
  tabIndex={0}
  data-testid="workbench-divider-left"
  className="panel-divider flex-shrink-0"
  onMouseDown={(event) => handleMouseDown('left', event)}
  onKeyDown={(event) => handleDividerKeyDown('left', event)}
  onDoubleClick={() => setLeftCollapsed(true)}
/>
```

Use the equivalent right label and width for the right divider. Add test IDs to all three panel wrappers and apply `quiet-workbench-panel` instead of `liquid-glass-panel` when `appearance === 'quiet-research'`.

- [ ] **Step 4: Add embedded-only visual tokens and reduced motion**

Create `src/styles/quiet-research-workbench.css`:

```css
.quiet-research-workbench {
  --quiet-bg: #f7f9fc;
  --quiet-panel: #ffffff;
  --quiet-panel-muted: #fafbfd;
  --quiet-border: #e4e9f1;
  --quiet-text: #142033;
  --quiet-muted: #65738a;
  --quiet-accent: #2866d7;
  color: var(--quiet-text);
  background: var(--quiet-bg);
}

.quiet-research-workbench .quiet-workbench-panel {
  min-width: 0;
  background: var(--quiet-panel);
  border: 0;
  box-shadow: none;
  transition: width 240ms ease-out, opacity 180ms ease-out;
}

.quiet-research-workbench .panel-divider {
  position: relative;
  width: 1px;
  background: var(--quiet-border);
  outline: none;
}

.quiet-research-workbench .panel-divider::before {
  content: '';
  position: absolute;
  inset: 0 -5px;
  cursor: col-resize;
}

.quiet-research-workbench .panel-divider::after {
  display: none;
}

.quiet-research-workbench .panel-divider:hover,
.quiet-research-workbench .panel-divider:focus-visible {
  background: var(--quiet-accent);
  box-shadow: 0 0 0 2px rgb(40 102 215 / 12%);
}

.quiet-research-workbench .quiet-enter {
  animation: quiet-enter 220ms ease-out both;
}

@keyframes quiet-enter {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .quiet-research-workbench *,
  .quiet-research-workbench *::before,
  .quiet-research-workbench *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
  }
}
```

Import it once in `src/app/globals.css`:

```css
@import "../styles/quiet-research-workbench.css";
```

- [ ] **Step 5: Activate 272/420 only for the embed**

In `AcademicPresenterContent`, wrap the shell and configure the layout:

```tsx
const quiet = paperHostContext.enabled;

<div className={`flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg-primary)] ${quiet ? 'quiet-research-workbench' : ''}`}>
  <WorkbenchTopBar
    workspaceTitle={workspaceTitle}
    onBackHome={onBackHome}
    onSignOut={onSignOut}
    embedded={quiet}
    authenticated={Boolean(accountSession)}
  />
  <div className="min-h-0 flex-1 quiet-enter">
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
      appearance={quiet ? 'quiet-research' : 'glass'}
      defaultLeftWidth={quiet ? 272 : 280}
      defaultRightWidth={quiet ? 420 : 500}
      initialMobilePanel={showSourceGuide ? 'left' : 'center'}
    />
  </div>
</div>
```

For the top bar root, use this exact variant expression so standalone styling stays intact:

```tsx
const shellClass = embedded
  ? 'z-40 flex h-14 flex-shrink-0 items-center justify-between gap-3 border-b border-[#E4E9F1] bg-white px-3 text-[#142033]'
  : 'z-40 flex h-16 flex-shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/94 px-4 text-[var(--text-primary)] shadow-[0_10px_30px_rgba(15,23,42,0.06)] backdrop-blur-xl';
```

- [ ] **Step 6: Run layout GREEN verification**

```powershell
pnpm smoke:embedded-quiet-workbench
pnpm ts-check
pnpm lint:build
```

Expected: PASS; browser output includes width, overflow, keyboard resize, and reduced-motion checks.

- [ ] **Step 7: Commit the layout shell**

```powershell
git add src/app/globals.css src/app/page.tsx src/components/layout/ThreeColumnLayout.tsx src/components/workbench/WorkbenchTopBar.tsx src/styles/quiet-research-workbench.css scripts/smoke-embedded-quiet-workbench.mjs
git diff --cached --check
git commit -m "style(workbench): refine the embedded research shell"
```

---

### Task 4: Compact empty states and tool cards without changing capabilities

**Files:**
- Modify: `src/app/page.tsx:42-101`
- Modify: `src/components/editor/EditorPanel.tsx:40-845`
- Modify: `src/components/studio/StudioPanel.tsx:20-81`
- Modify: `src/components/studio/StudioToolSwitcher.tsx:60-130`
- Modify: `scripts/smoke-embedded-quiet-workbench.mjs`

**Interfaces:**
- Produces: `EditorPanel.compact?: boolean`.
- Produces: `StudioPanel.compact?: boolean`.
- Produces: `StudioToolSwitcher.compact?: boolean`.
- Consumes: the same `paperHostContext.enabled` quiet flag from Task 3.

- [ ] **Step 1: Add density RED assertions to the browser smoke**

Add after workbench load:

```js
const quickQuestions = embedded.locator('.quick-question-button:visible');
assert(await quickQuestions.count() <= 4, `Embedded empty state exposed ${await quickQuestions.count()} oversized quick actions.`);

const studioCards = embedded.locator('[data-testid^="studio-nav-"]:visible');
const firstCard = await studioCards.first().boundingBox();
assert(firstCard && firstCard.height <= 58, `Studio tool card is too tall: ${firstCard?.height}.`);

await studioCards.nth(1).click();
assert(await studioCards.nth(1).getAttribute('aria-pressed') === 'true', 'Tool selection gave no visible selected state.');
```

- [ ] **Step 2: Run the smoke and verify RED**

```powershell
pnpm smoke:embedded-quiet-workbench
```

Expected: FAIL because the empty state renders 8 quick cards and current tool cards exceed the compact height.

- [ ] **Step 3: Add explicit compact props instead of CSS-only hiding**

Change the `EditorPanel` declaration, add `compact` to `ChatViewProps`, and pass it at the current `ChatView` call site:

```tsx
// Replace: export function EditorPanel() {
export function EditorPanel({ compact = false }: { compact?: boolean }) {

interface ChatViewProps {
  compact: boolean;
  messages: ChatMessage[];
  inputMessage: string;
  setInputMessage: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onQuickQuestion: (question: string) => void;
  isGenerating: boolean;
  expandedCitations: Set<string>;
  onToggleCitation: (id: string) => void;
  onScrollAreaReady: (node: HTMLDivElement | null) => void;
  quickQuestions: QuickQuestion[];
  selectedSourceCount: number;
  totalSourceCount: number;
  onCitationClick: (paperId: string, citation?: Citation) => void;
  onRegenerate: () => void;
}

<ChatView
  compact={compact}
  messages={chatMessages}
  inputMessage={inputMessage}
  setInputMessage={setInputMessage}
  onSend={() => sendQuestion(inputMessage)}
  onStop={stopGeneration}
  onQuickQuestion={sendQuestion}
  isGenerating={isGenerating}
  expandedCitations={expandedCitations}
  onToggleCitation={toggleCitation}
  onScrollAreaReady={(node) => { scrollRef.current = node; }}
  quickQuestions={QUICK_QUESTIONS}
  selectedSourceCount={selectedSourceCount}
  totalSourceCount={totalSourceCount}
  onCitationClick={revealPaper}
  onRegenerate={regenerateLastAnswer}
/>

const visibleQuickQuestions = compact ? quickQuestions.slice(0, 4) : quickQuestions;
```

Use `visibleQuickQuestions` in both quick-question maps. In compact mode change the empty-state wrapper to a smaller icon (`h-12 w-12`), `mt-5` question spacing, two desktop columns, and 52px minimum card height. Do not change the action handlers or disabled rules.

Apply these exact signature and class changes in `StudioPanel`; retain both current effects that resolve `hideVirtualClassroom` and repair an invalid active tab:

```tsx
// Replace: export function StudioPanel() {
export function StudioPanel({ compact = false }: { compact?: boolean }) {

// Replace the root panel opening tag.
<div className="h-full overflow-y-auto" data-density={compact ? 'compact' : 'default'}>

// Replace the header wrapper opening tag.
<div className={compact
  ? 'border-b border-[#E4E9F1] px-4 pb-3 pt-3'
  : 'border-b border-[var(--glass-border)] px-5 pb-4 pt-5'}>

// Replace the title-row opening tag and title size.
<div className={compact ? 'mb-3 flex items-center gap-2.5' : 'mb-4 flex items-center gap-3'}>
<h2 className={compact
  ? 'text-sm font-semibold tracking-tight text-[var(--text-primary)]'
  : 'text-base font-semibold tracking-tight text-[var(--text-primary)]'}>
  产物中心
</h2>

// Replace the switcher call.
<StudioToolSwitcher
  compact={compact}
  activeTab={activeTab}
  onSelect={setActiveTab}
  navItems={visibleNavItems}
/>

// Replace the content wrapper opening tag.
<div className={compact ? 'px-4 py-3' : 'px-5 py-4'}>
```

Update `StudioToolSwitcher` props and classes:

```tsx
export function StudioToolSwitcher({
  activeTab,
  onSelect,
  navItems = getVisibleStudioNav(),
  compact = false,
}: {
  activeTab: StudioTab;
  onSelect: (tab: StudioTab) => void;
  navItems?: StudioNavItem[];
  compact?: boolean;
}) {
  const cardClass = compact
    ? 'rounded-xl border px-2.5 py-2 text-left transition-colors duration-200'
    : 'spotlight-glass-card rounded-xl border px-3 py-2.5 text-left transition-all';

  const renderNavButton = (item: StudioNavItem) => {
    const Icon = item.icon;
    const isActive = activeTab === item.id;
    return (
      <button
        key={item.id}
        data-testid={`studio-nav-${item.id}`}
        aria-pressed={isActive}
        onClick={() => onSelect(item.id)}
        className={`${cardClass} ${isActive
          ? 'border-blue-400/50 bg-blue-500/10'
          : 'border-[var(--glass-border)] bg-[var(--glass-subtle)] hover:border-[var(--border-hover)]'}`}
        title={`${item.label}：${item.desc}`}
      >
        <span className="flex items-center gap-2">
          <span className={`flex ${compact ? 'h-7 w-7 rounded-lg' : 'h-8 w-8 rounded-xl'} shrink-0 items-center justify-center bg-gradient-to-br ${item.accent}`}>
            <Icon className="h-4 w-4 text-[var(--text-secondary)]" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[11px] font-semibold leading-tight text-[var(--text-primary)]">{item.label}</span>
            <span className="mt-0.5 block truncate text-[10px] leading-tight text-[var(--text-tertiary)]">{item.desc}</span>
          </span>
        </span>
      </button>
    );
  };
}
```

- [ ] **Step 4: Pass compact mode only in embedded workbench**

In `src/app/page.tsx`:

```tsx
function WorkbenchCenterPanel({ compact }: { compact: boolean }) {
  const { virtualClassroomViewer, knowledgeMapViewer } = useApp();
  if (virtualClassroomViewer) return <VirtualClassroomWorkspace />;
  if (knowledgeMapViewer) return <KnowledgeMapWorkspace />;
  return <EditorPanel compact={compact} />;
}

centerPanel={<WorkbenchCenterPanel compact={quiet} />}
rightPanel={<StudioPanel compact={quiet} />}
```

- [ ] **Step 5: Verify GREEN without invoking any model**

```powershell
pnpm smoke:embedded-quiet-workbench
pnpm smoke:workbench-studio-ui
pnpm test:studio-nav-side-effects
pnpm ts-check
pnpm lint:build
```

Expected: PASS. The workbench studio smoke uses intercepted local routes and does not call a paid provider.

- [ ] **Step 6: Commit density changes**

```powershell
git add src/app/page.tsx src/components/editor/EditorPanel.tsx src/components/studio/StudioPanel.tsx src/components/studio/StudioToolSwitcher.tsx scripts/smoke-embedded-quiet-workbench.mjs
git diff --cached --check
git commit -m "style(workbench): compact embedded research tools"
```

---

### Task 5: Make the paper-web guest notice non-blocking

**Files:**
- Modify in paper-web: `src/components/common/EmbedAccountNotice.vue:31-130`
- Create in paper-web: `test/unit/specs/embedAccountNotice.spec.js`

**Interfaces:**
- Consumes: the current `state: object` and `compact: boolean` props without changing their data shape.
- Produces: the same `login` event and action copy; only compact presentation changes.
- Preserves: roundtable full/login-required notice because `.is-full` is unchanged.

- [ ] **Step 1: Write the host notice RED contract**

Create `test/unit/specs/embedAccountNotice.spec.js`:

```js
/* eslint-env jest */

import fs from 'fs';
import path from 'path';
import { buildEmbedAccessState } from '@/common/embedAccessModel';

describe('embedded account notice presentation', () => {
  it('keeps the isolated guest meaning and login recovery action', () => {
    expect(buildEmbedAccessState({
      loggedIn: false,
      feature: '科研智能体',
      guestEnabled: true
    })).toMatchObject({
      mode: 'guest',
      title: '当前为访客体验空间',
      actionLabel: '登录同步工作区'
    });
  });

  it('exposes a compact hook without changing the full login-required notice', () => {
    const source = fs.readFileSync(path.resolve('src/components/common/EmbedAccountNotice.vue'), 'utf8');
    expect(source).toContain("compact ? 'is-compact' : 'is-full'");
    expect(source).toContain('data-testid="embed-account-notice"');
    expect(source).toContain('data-testid="embed-account-notice-action"');
  });
});
```

The first test is the behavioral data contract; the second is only a stable DOM-hook guard for the real browser acceptance step.

- [ ] **Step 2: Run the targeted test and verify RED**

```powershell
npm run unit -- --runInBand test/unit/specs/embedAccountNotice.spec.js
```

Expected: FAIL because the two `data-testid` hooks do not exist.

- [ ] **Step 3: Add stable hooks and compact styles**

Update the opening section and button:

```vue
<section
  :class="['embed-account-notice', compact ? 'is-compact' : 'is-full']"
  role="status"
  data-testid="embed-account-notice"
>
  <div class="notice-icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M12 3.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-7 16c.8-3.6 3.2-5.4 7-5.4s6.2 1.8 7 5.4"/>
    </svg>
  </div>
  <div class="notice-copy">
    <strong>{{ state.title }}</strong>
    <span>{{ state.description }}</span>
  </div>
  <button
    type="button"
    class="notice-action"
    data-testid="embed-account-notice-action"
    @click="$emit('login')"
  >
    {{ state.actionLabel }}
  </button>
</section>
```

Replace only `.is-compact` and its child overrides:

```scss
.is-compact {
  position: absolute;
  top: 8px;
  right: 12px;
  z-index: 4;
  width: auto;
  max-width: min(440px, calc(100% - 24px));
  min-height: 44px;
  padding: 6px 8px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 8px 24px rgba(28, 45, 75, 0.08);

  .notice-icon { width: 30px; height: 30px; border-radius: 9px; }
  .notice-icon svg { width: 18px; height: 18px; }
  .notice-copy { flex: 1; gap: 1px; }
  .notice-copy strong { font-size: 12px; }
  .notice-copy span { max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
  .notice-action { height: 32px; padding: 0 12px; font-size: 12px; }
}
```

- [ ] **Step 4: Run paper-web GREEN gates**

```powershell
npm run unit -- --runInBand test/unit/specs/embedAccountNotice.spec.js test/unit/specs/embedAccessModel.spec.js test/unit/specs/agentShellNavigation.spec.js
npm run lint:added
npm run lint:hygiene
npm run lint:test
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit and push the isolated paper-web change**

```powershell
git add src/components/common/EmbedAccountNotice.vue test/unit/specs/embedAccountNotice.spec.js
git diff --cached --check
git commit -m "style(agent): compact the guest workspace notice"
git push origin research/platform-upgrade
```

Verify `git rev-list --left-right --count origin/research/platform-upgrade...HEAD` returns `0 0`.

---

### Task 6: Run full gates, formal-domain acceptance, release, and rollback audit

**Files:**
- Modify after verification: external evidence files under `C:\Users\16571\Documents\Codex\2026-07-10\ssh-root-123-56-218-60\outputs\` only.
- Do not add screenshots, build output, credentials, runtime data, or release artifacts to either repository.

**Interfaces:**
- Consumes: Tasks 1–5 commits and the existing timestamped release tooling.
- Produces: one clean KnowTrail release, one clean paper-web release if Task 5 changed the host bundle, and a machine-readable rollback record.

- [ ] **Step 1: Run all KnowTrail gates from a clean audit tree**

```powershell
git status --short --branch
pnpm test:embedded-entry-state
pnpm smoke:embedded-quiet-workbench
pnpm validate
pnpm ts-check
pnpm lint:build
pnpm build
pnpm package:linux
git diff --check
```

Expected: clean status except intentional commits; all commands exit 0; no paid AI request occurs.

- [ ] **Step 2: Run repository hygiene scans**

```powershell
git grep -n -I -E "(console\.log\(|debugger;|T[D]O|F[I]XME)" -- src scripts
git diff HEAD~4..HEAD -- . ':!pnpm-lock.yaml' | Select-String -Pattern '(sk-[A-Za-z0-9]|Bearer\s+[A-Za-z0-9._-]{20,}|password\s*=|token\s*=)' -CaseSensitive
```

Expected: no new debug residue and no credential-like match in the changed range. Existing intentional `console.log` in executable test scripts must be limited to final machine-readable success output.

- [ ] **Step 3: Run all paper-web gates from Research**

```powershell
npm run lint:added
npm run lint:hygiene
npm run lint:test
npm run unit -- --runInBand
npm run build:prod
git diff --check
node scripts/scan-commit-secrets.cjs
```

Expected: all commands exit 0; Research is `0 0` against `origin/research/platform-upgrade`.

- [ ] **Step 4: Build and verify isolated standby releases**

Use the existing release scripts and a fresh timestamp for each changed application. Before switching symlinks, verify:

```text
manifest.dirty=false
standby /api/health -> ok=true
paper-web standby index and assets -> 200
KnowTrail standby embedded URL -> notebook list visible
no current/previous symlink target is overwritten
```

Do not substitute process-online or HTTP 200 for browser behavior.

- [ ] **Step 5: Run formal-domain 1440px acceptance**

From `http://ucas.sitianai.com/`, execute this exact user path:

1. Click 智能体 from the platform navigation.
2. Confirm no marketing page or KnowTrail word is visible during first meaningful paint.
3. Confirm the compact guest notice does not cover the notebook header or create action.
4. Create a new notebook and confirm the workbench opens.
5. Confirm left/center/right widths are approximately 272/flexible/420 and the document has no horizontal overflow.
6. Resize each divider by pointer and keyboard; collapse and restore both side panels.
7. Confirm the empty-state quick actions are at most four and each visible action responds.
8. Select two product tools and confirm the selected state and corresponding panel change.
9. Add one non-paid source fixture, refresh, confirm persistence, delete it, refresh, and confirm cleanup.
10. Return to the notebook list and then back to the 科教 platform.
11. Confirm console error count is zero and failed requests have user-readable recovery.
12. Open an independent standalone KnowTrail URL and confirm its brand/landing page still exists.
13. Repeat entry, notebook-list visibility, back navigation, and horizontal-overflow checks at 390px; do not change the deferred mobile shell unless this regression check finds a new blocker.

- [ ] **Step 6: Atomically publish and verify runtime health**

Switch KnowTrail first, verify it through the formal iframe, then switch paper-web. After each switch verify:

```text
current and previous point to distinct timestamped releases
Nginx configuration test passes
PM2/service process is online on the expected loopback port
/health and /ready return the expected JSON
DB readiness probe passes
paper-platform-health.timer is active and last run succeeded
disk has safe free space
no abandoned standby port remains
```

- [ ] **Step 7: Exercise rollback once before finalizing**

For each changed runtime, switch from the new candidate to previous, verify health and the formal route, then switch back to the new candidate and verify again. Record both symlink targets and timestamps without copying environment values.

- [ ] **Step 8: Update audit evidence**

Update these existing files with the final SHAs, release names, RED/GREEN evidence, browser path, rollback, remaining provider limitations, and next single task:

```text
outputs/paper-platform-functional-matrix.md
outputs/paper-platform-unified-remaining-tasks-20260713.md
outputs/paper-platform-online-baseline-20260712.md
outputs/paper-platform-polish-loop.md
```

- [ ] **Step 9: Final stop condition**

Stop this visual work when all formal-domain acceptance steps pass and there is no user-visible Quiet Research regression. Do not continue changing colors, motion, or spacing without a new observed defect. Keep the high-cost login switch and incomplete provider/account/billing readiness as separate capability work.
