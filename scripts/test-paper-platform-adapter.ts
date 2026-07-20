import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAPER_PLATFORM_ADAPTER } from './paper-platform-adapter-manifest.mjs';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

for (const path of PAPER_PLATFORM_ADAPTER.requiredFiles) {
  assert.equal(existsSync(join(process.cwd(), path)), true, `missing adapter file: ${path}`);
}

const bridge = read('src/lib/paper-host-bridge.ts');
for (const key of PAPER_PLATFORM_ADAPTER.queryParams) {
  assert.match(bridge, new RegExp(`['"]${key}['"]`), `bridge must read ${key}`);
}

const requestScope = read('src/lib/paper-host-request-scope.ts');
assert.match(requestScope, /paper-host:\$\{safeWorkspaceKey\}/);
assert.match(requestScope, /status:\s*401/);

const page = read('src/app/page.tsx');
assert.match(page, /installPaperHostBridge\(\)/);
assert.match(page, /paperHostSignInRequired/);
assert.match(page, /paper-host:login-required/);
assert.match(page, /resolveEmbeddedEntryState\(/);

const entryState = read('src/lib/embedded-entry-state.ts');
assert.match(entryState, /normalizeNotebookId\(params\.get\('notebookId'\)\)/);
assert.match(entryState, /embedded \|\| hash === '#notebooks'/);

const studioSwitcher = read('src/components/studio/StudioToolSwitcher.tsx');
for (const key of PAPER_PLATFORM_ADAPTER.visibilityParams) {
  assert.match(studioSwitcher, new RegExp(`['"]${key}['"]`), `studio visibility must read ${key}`);
}
assert.match(studioSwitcher, /item\.id !== 'virtual-classroom'/);

for (const path of PAPER_PLATFORM_ADAPTER.scopedRoutes) {
  assert.match(
    read(path),
    /readPaperHostRequestScope|resolveAccountNotebookScope/,
    `${path} must use paper-host ownership`,
  );
}

console.log(JSON.stringify({ ok: true, checked: PAPER_PLATFORM_ADAPTER.requiredFiles.length }));
