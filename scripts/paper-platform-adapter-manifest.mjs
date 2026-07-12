import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const PAPER_PLATFORM_ADAPTER = Object.freeze({
  queryParams: [
    'host',
    'hostBridge',
    'hostBridgeVersion',
    'workspaceKey',
    'accountScope',
    'embedAuthMode',
  ],
  visibilityParams: ['embed', 'hideVirtualClassroom'],
  requiredFiles: [
    'src/lib/paper-host-bridge.ts',
    'src/lib/paper-host-request-scope.ts',
    'src/lib/account-request-scope.ts',
    'src/app/page.tsx',
    'src/app/api/upload/route.ts',
    'src/app/api/ingestion/sources/route.ts',
    'src/app/api/ai/chat/route.ts',
    'src/app/api/ai/podcast/route.ts',
    'src/components/studio/StudioPanel.tsx',
    'src/components/studio/StudioToolSwitcher.tsx',
  ],
  scopedRoutes: [
    'src/app/api/upload/route.ts',
    'src/app/api/ingestion/sources/route.ts',
    'src/app/api/ai/chat/route.ts',
    'src/app/api/ai/podcast/route.ts',
  ],
});

export function verifyPaperPlatformAdapter(root = process.cwd()) {
  const missing = PAPER_PLATFORM_ADAPTER.requiredFiles.filter(
    file => !existsSync(resolve(root, file)),
  );
  return {
    ok: missing.length === 0,
    adapterFiles: PAPER_PLATFORM_ADAPTER.requiredFiles.length,
    scopedRoutes: PAPER_PLATFORM_ADAPTER.scopedRoutes.length,
    missing,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = verifyPaperPlatformAdapter();
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}
