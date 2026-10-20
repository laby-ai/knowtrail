import { runPnpmSync } from './lib/pnpm-runner.mjs';

for (const basePath of ['', '/lingbi', '/knowtrail', '/knowtrail/']) {
  runPnpmSync(['exec', 'tsx', '-e', `
    import assert from 'node:assert/strict';
    import { NOTEBOOK_HOME_HREF, ACCOUNT_NOTEBOOK_NEXT } from './src/components/home/workspace-types.ts';
    import { appPublicPath } from './src/lib/app-public-path.ts';
    const base = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/[/]$/, '');
    assert.equal(NOTEBOOK_HOME_HREF, '/?view=notebooks', 'Next Link must receive an app-relative route');
    assert.equal(decodeURIComponent(ACCOUNT_NOTEBOOK_NEXT), base + '/?view=notebooks', 'Native login return must retain the deployment prefix');
    assert.equal(appPublicPath('/assets/brand/lingbi-mark.svg'), base + '/assets/brand/lingbi-mark.svg');
    assert.equal(appPublicPath('/account?next=' + ACCOUNT_NOTEBOOK_NEXT), base + '/account?next=' + ACCOUNT_NOTEBOOK_NEXT);
  `], {
    cwd: process.cwd(),
    env: { ...process.env, NEXT_PUBLIC_BASE_PATH: basePath },
  });
}

console.log('Home navigation retains root, legacy and current deployment paths.');
