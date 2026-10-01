import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspace = process.env.APP_WORKSPACE_PATH || process.cwd();
const nextServerDir = path.join(workspace, '.next', 'server');
const nodeModulesDir = path.join(workspace, 'node_modules');

const KNOWN_EXTERNALS = [
  { pattern: /^pg-[a-f0-9]{16,}$/i, packageName: 'pg' },
  { pattern: /^@aws-sdk\/client-s3-[a-f0-9]{16,}$/i, packageName: '@aws-sdk/client-s3' },
  { pattern: /^@zvec\/zvec-[a-f0-9]{16,}$/i, packageName: '@zvec/zvec' },
];

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
    } else if (entry.isFile() && /\.(js|json)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function packagePath(packageName) {
  return path.join(nodeModulesDir, ...packageName.split('/'));
}

async function ensureAlias(alias, packageName) {
  const targetPath = packagePath(packageName);
  const aliasPath = packagePath(alias);
  if (!existsSync(targetPath)) {
    throw new Error(`Cannot create Next external alias ${alias}: missing node_modules package ${packageName}`);
  }

  await mkdir(path.dirname(aliasPath), { recursive: true });
  await rm(aliasPath, { recursive: true, force: true });
  const relativeTarget = path.relative(path.dirname(aliasPath), targetPath) || '.';
  const symlinkTarget = process.platform === 'win32' ? targetPath : relativeTarget;
  const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
  await symlink(symlinkTarget, aliasPath, symlinkType);
  return { alias, packageName, aliasPath, targetPath };
}

async function main() {
  if (!existsSync(nextServerDir)) {
    throw new Error('Missing .next/server. Run pnpm build before ensuring Next external aliases.');
  }
  if (!existsSync(nodeModulesDir)) {
    throw new Error('Missing node_modules. Run pnpm install before ensuring Next external aliases.');
  }

  const aliases = new Map();
  for (const file of await collectFiles(nextServerDir)) {
    const content = await readFile(file, 'utf8');
    for (const match of content.matchAll(/(?:^|["'`])((?:@aws-sdk\/client-s3|@zvec\/zvec|pg)-[a-f0-9]{16,})(?=["'`])/gi)) {
      const alias = match[1];
      const known = KNOWN_EXTERNALS.find(item => item.pattern.test(alias));
      if (known) aliases.set(alias, known.packageName);
    }
  }

  const ensured = [];
  for (const [alias, packageName] of aliases) {
    ensured.push(await ensureAlias(alias, packageName));
  }

  console.log(JSON.stringify({
    ok: true,
    checked: '.next/server external package aliases',
    aliasCount: ensured.length,
    aliases: ensured.map(item => ({ alias: item.alias, packageName: item.packageName })),
  }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
});
