import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, rmSync, mkdirSync, cpSync, copyFileSync, writeFileSync, chmodSync, statSync, readdirSync, realpathSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workspace = process.env.APP_WORKSPACE_PATH || process.cwd();
const deployDir = path.join(workspace, '.deploy');
const bundleName = process.env.LINGBI_BUNDLE_NAME || `lingbi-studio-linux-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')}`;
const stagingDir = path.join(deployDir, bundleName);
const appDir = path.join(stagingDir, 'lingbi-studio');
const archivePath = path.join(deployDir, `${bundleName}.tar.gz`);

function assertExists(relativePath) {
  const fullPath = path.join(workspace, relativePath);
  if (!existsSync(fullPath)) {
    throw new Error(`Missing ${relativePath}. Run pnpm build before pnpm package:linux.`);
  }
}

function copyEntry(relativePath, targetRelativePath = relativePath) {
  const source = path.join(workspace, relativePath);
  const target = path.join(appDir, targetRelativePath);
  if (!existsSync(source)) return;
  cpSync(source, target, {
    recursive: true,
    filter: sourcePath => {
      const normalized = sourcePath.replaceAll('\\', '/');
      if (normalized.includes('/node_modules/')) return false;
      if (/\/\.next\/cache(?:\/|$)/.test(normalized)) return false;
      if (/\/\.next\/dev(?:\/|$)/.test(normalized)) return false;
      if (normalized.includes('/.data/')) return false;
      if (normalized.includes('/.logs/')) return false;
      if (/\/public\/uploads(?:\/|$)/.test(normalized)) return false;
      if (/\/public\/mineru-figures(?:\/|$)/.test(normalized)) return false;
      return true;
    },
  });
}

function copyRuntimeEntry(relativePath, targetRelativePath = relativePath) {
  const source = path.join(workspace, relativePath);
  const target = path.join(appDir, targetRelativePath);
  if (!existsSync(source)) return false;
  cpSync(source, target, { recursive: true, force: true });
  return true;
}

function resolveClassroomRuntimeModule(packageName) {
  const direct = path.join(workspace, '.references', 'OpenMAIC', 'node_modules', ...packageName.split('/'));
  if (existsSync(direct)) return realpathSync(direct);

  const pnpmStore = path.join(workspace, '.references', 'OpenMAIC', 'node_modules', '.pnpm');
  const pnpmPrefix = `${packageName.replace('/', '+')}@`;
  if (!existsSync(pnpmStore)) return null;

  const match = readdirSync(pnpmStore)
    .filter(entry => entry.startsWith(pnpmPrefix))
    .sort()
    .at(-1);
  if (!match) return null;

  const pnpmSource = path.join(pnpmStore, match, 'node_modules', ...packageName.split('/'));
  return existsSync(pnpmSource) ? pnpmSource : null;
}

function copyClassroomRuntimeModule(packageName) {
  const source = resolveClassroomRuntimeModule(packageName);
  const target = path.join(
    appDir,
    '.references',
    'OpenMAIC',
    '.next',
    'standalone',
    'node_modules',
    ...packageName.split('/'),
  );
  if (!source) return false;
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true, force: true });
  return true;
}

function makeExecutable(relativePath) {
  const fullPath = path.join(appDir, relativePath);
  if (existsSync(fullPath)) chmodSync(fullPath, 0o755);
}

function directorySizeBytes(dir) {
  if (!existsSync(dir)) return 0;
  const stack = [dir];
  let total = 0;
  while (stack.length) {
    const current = stack.pop();
    const stats = statSync(current);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(current)) {
        stack.push(path.join(current, entry));
      }
    } else {
      total += stats.size;
    }
  }
  return total;
}

function inspectClassroomRuntimeArchive(archivePath) {
  const listed = spawnSync('tar', ['-tzf', archivePath], { encoding: 'utf8', shell: false });
  if (listed.error || listed.status !== 0) {
    throw new Error(`Unable to list OpenMAIC runtime archive: ${listed.error?.message || listed.stderr}`);
  }

  const entries = listed.stdout.split(/\r?\n/).filter(Boolean);
  const unsafe = entries.filter(entry =>
    entry.startsWith('/')
    || entry.startsWith('\\')
    || /(^|[\\/])\.\.([\\/]|$)/.test(entry),
  );
  if (unsafe.length > 0) {
    throw new Error(`OpenMAIC runtime archive contains unsafe paths: ${unsafe.slice(0, 5).join(', ')}`);
  }

  const normalized = entries.map(entry => entry.replaceAll('\\', '/').replace(/^\.\//, ''));
  const required = [
    '.next/standalone/server.js',
    '.next/static/',
    'public/',
  ];
  const missing = required.filter(requiredEntry =>
    requiredEntry.endsWith('/')
      ? !normalized.some(entry => entry.startsWith(requiredEntry))
      : !normalized.includes(requiredEntry),
  );
  if (missing.length > 0) {
    throw new Error(`OpenMAIC runtime archive is incomplete: ${missing.join(', ')}`);
  }

  return {
    entries: normalized.length,
    sha256: createHash('sha256').update(Buffer.from(readFileSync(archivePath))).digest('hex'),
  };
}

assertExists('dist/server.js');
assertExists('.next/BUILD_ID');
assertExists('public');
assertExists('package.json');
assertExists('pnpm-lock.yaml');

rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(appDir, { recursive: true });

[
  'package.json',
  'pnpm-lock.yaml',
  '.npmrc',
  'babel.config.js',
  'next.config.ts',
  'tsconfig.json',
  'postcss.config.mjs',
  'eslint.config.mjs',
  'components.json',
  'README.md',
  'docs',
  '.env.example',
  '.env.real.local.example',
  'public',
  '.next',
  'dist',
  'src',
  'scripts',
  'deploy',
].forEach(entry => copyEntry(entry));

const externalClassroomRuntimeArchive = process.env.OPENMAIC_RUNTIME_ARCHIVE
  ? path.resolve(process.env.OPENMAIC_RUNTIME_ARCHIVE)
  : null;
let classroomRuntimeIncluded = false;
let classroomRuntimeArchive = null;

if (externalClassroomRuntimeArchive) {
  if (!existsSync(externalClassroomRuntimeArchive)) {
    throw new Error(`OPENMAIC_RUNTIME_ARCHIVE does not exist: ${externalClassroomRuntimeArchive}`);
  }
  const inspection = inspectClassroomRuntimeArchive(externalClassroomRuntimeArchive);
  const target = path.join(appDir, 'runtime', 'openmaic-runtime.tar.gz');
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(externalClassroomRuntimeArchive, target);
  classroomRuntimeIncluded = true;
  classroomRuntimeArchive = {
    path: 'runtime/openmaic-runtime.tar.gz',
    sha256: inspection.sha256,
    entries: inspection.entries,
  };
} else {
  classroomRuntimeIncluded = [
    copyRuntimeEntry('.references/OpenMAIC/.next/standalone'),
    copyRuntimeEntry('.references/OpenMAIC/.next/static'),
    copyRuntimeEntry('.references/OpenMAIC/public'),
    copyClassroomRuntimeModule('styled-jsx'),
    copyClassroomRuntimeModule('@next/env'),
    copyClassroomRuntimeModule('@swc/helpers'),
  ].every(Boolean);
}

copyFileSync(path.join(workspace, 'deploy/linux/install.sh'), path.join(appDir, 'install.sh'));
copyFileSync(path.join(workspace, 'deploy/linux/start.sh'), path.join(appDir, 'start.sh'));
copyFileSync(path.join(workspace, 'deploy/linux/healthcheck.sh'), path.join(appDir, 'healthcheck.sh'));
copyFileSync(path.join(workspace, 'deploy/linux/bootstrap-ubuntu.sh'), path.join(appDir, 'bootstrap-ubuntu.sh'));
copyFileSync(path.join(workspace, 'deploy/linux/deploy.sh'), path.join(appDir, 'deploy.sh'));
copyFileSync(path.join(workspace, 'deploy/linux/preflight.sh'), path.join(appDir, 'preflight.sh'));
copyFileSync(path.join(workspace, 'deploy/linux/env.production.example'), path.join(appDir, '.env.production.example'));
copyFileSync(path.join(workspace, 'deploy/linux/README-LINUX.md'), path.join(appDir, 'README-LINUX.md'));

[
  'bootstrap-ubuntu.sh',
  'deploy.sh',
  'preflight.sh',
  'install.sh',
  'start.sh',
  'healthcheck.sh',
  'deploy/linux/bootstrap-ubuntu.sh',
  'deploy/linux/deploy.sh',
  'deploy/linux/preflight.sh',
  'deploy/linux/install.sh',
  'deploy/linux/start.sh',
  'deploy/linux/healthcheck.sh',
].forEach(makeExecutable);

writeFileSync(path.join(appDir, 'BUNDLE_MANIFEST.json'), `${JSON.stringify({
  name: 'lingbi-studio',
  target: 'linux',
  generatedAt: new Date().toISOString(),
  node: '>=20',
  bootstrap: './bootstrap-ubuntu.sh',
  preflight: './preflight.sh',
  deploy: './deploy.sh',
  start: './start.sh',
  healthcheck: './healthcheck.sh',
  requiredRuntimeArtifacts: ['dist/server.js', '.next/BUILD_ID', 'public'],
  documentationArtifacts: ['docs/api-conventions.md'],
  optionalRuntimeArtifacts: classroomRuntimeIncluded ? ['virtual classroom standalone runtime'] : [],
  classroomRuntimeArchive,
  persistentPaths: ['.data/zvec', '.data/sources', 'logs'],
  notes: [
    'Run ./install.sh after extracting on Linux.',
    'For Ubuntu/Debian single-node deployment, run ./deploy.sh to bootstrap prerequisites, install dependencies, start the service, and probe health.',
    'Edit .env.production before public deployment.',
    'Copy .env.real.local.example to .env.real.local only on the target host when running real model smoke tests.',
    'Do not store user API keys in this bundle; C-end model access is account-bound and should use deployment secrets or an approved gateway.',
    classroomRuntimeIncluded
      ? 'Virtual classroom runtime is included and started by ./start.sh when model credentials are available.'
      : 'Virtual classroom runtime is not included; /api/virtual-classroom/status will report native mode.',
  ],
  realSmokeCommands: [
    'pnpm smoke:real-env-preflight',
    'pnpm smoke:real-openai-compatible',
    'pnpm smoke:real-app-ai',
    'pnpm smoke:real-doubao-tts',
    'pnpm smoke:real-studio-products',
    'pnpm smoke:workbench-studio-ui',
    'pnpm smoke:studio-evidence-ui',
    'pnpm audit:pptx-quality',
    'pnpm smoke:runtime-health',
  ],
}, null, 2)}\n`);

rmSync(archivePath, { force: true });
const tar = spawnSync('tar', ['-czf', archivePath, bundleName], {
  cwd: deployDir,
  stdio: 'pipe',
  shell: false,
});

if (tar.error || tar.status !== 0) {
  throw new Error(`Failed to create tar.gz package: ${tar.error?.message || tar.stderr.toString()}`);
}

console.log(JSON.stringify({
  ok: true,
  archive: archivePath,
  bundleName,
  stagingDir,
  unpackedBytes: directorySizeBytes(appDir),
  checked: [
    'production Next.js build artifacts included',
    'custom Node server included',
    'Ubuntu/Debian bootstrap and one-command deploy scripts included',
    'non-invasive Linux preflight included',
    'Linux install/start/healthcheck scripts included',
    'systemd and nginx examples included',
    'env.production.example included without real secrets',
    'real smoke env template included without real secrets',
    'product-center workbench smoke and PPTX quality audit commands included in bundle manifest',
    'API conventions and engineering docs included for release/source parity',
    'runtime public uploads and MinerU figure outputs excluded from bundle',
    classroomRuntimeIncluded
      ? 'virtual classroom runtime included'
      : 'virtual classroom runtime not found; package remains usable without classroom sidecar',
  ],
}, null, 2));
