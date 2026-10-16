import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const workspace = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-next-externals-'));
const scriptPath = path.join(import.meta.dirname, 'ensure-next-external-aliases.mjs');
const alias = '@aws-sdk/client-s3-0123456789abcdef';
const targetPath = path.join(workspace, 'node_modules', '@aws-sdk', 'client-s3');
const rootAliasPath = path.join(workspace, 'node_modules', ...alias.split('/'));
const nextAliasPath = path.join(workspace, '.next', 'node_modules', ...alias.split('/'));

try {
  await mkdir(path.join(workspace, '.next', 'server'), { recursive: true });
  await mkdir(targetPath, { recursive: true });
  await mkdir(nextAliasPath, { recursive: true });
  await writeFile(path.join(workspace, '.next', 'server', 'route.js'), `require(${JSON.stringify(alias)});`);
  await writeFile(path.join(targetPath, 'package.json'), JSON.stringify({ name: '@aws-sdk/client-s3' }));
  await writeFile(path.join(nextAliasPath, 'stale-build-copy.txt'), 'stale');

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: workspace,
    env: { ...process.env, APP_WORKSPACE_PATH: workspace },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const output = JSON.parse(result.stdout);
  assert.equal(output.aliasCount, 1);
  assert.deepEqual(output.aliases[0].locations.sort(), [
    path.join('.next', 'node_modules', ...alias.split('/')),
    path.join('node_modules', ...alias.split('/')),
  ].sort());
  assert.equal(await realpath(rootAliasPath), await realpath(targetPath));
  assert.equal(await realpath(nextAliasPath), await realpath(targetPath));
  await assert.rejects(readFile(path.join(nextAliasPath, 'stale-build-copy.txt')));

  console.log(JSON.stringify({ ok: true, checked: 'root and .next external aliases' }));
} finally {
  await rm(workspace, { recursive: true, force: true });
}
