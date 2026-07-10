import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const deployDir = path.join(repoRoot, '.deploy');
const requiredScripts = [
  'smoke:real-env-preflight',
  'smoke:real-openai-compatible',
  'smoke:real-app-ai',
  'smoke:real-doubao-tts',
  'smoke:real-studio-products',
  'smoke:workbench-studio-ui',
  'smoke:studio-evidence-ui',
  'audit:pptx-quality',
  'validate',
  'test:release-env-gate',
  'smoke:runtime-health',
];

const requiredFiles = [
  'BUNDLE_MANIFEST.json',
  'package.json',
  'README-LINUX.md',
  '.env.production.example',
  '.env.real.local.example',
  'docs/api-conventions.md',
  'dist/server.js',
  '.next/BUILD_ID',
  'scripts/smoke-real-studio-products.mjs',
  'scripts/smoke-real-doubao-tts.ts',
  'scripts/audit-pptx-quality.mjs',
  'deploy/linux/preflight.sh',
  'deploy/linux/healthcheck.sh',
  'scripts/prepare-release-env.mjs',
  'scripts/verify-release-health.mjs',
  'scripts/promote-release.mjs',
  'scripts/lib/release-env-gate.mjs',
  'scripts/test-release-env-gate.mjs',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function findLatestArchive() {
  const files = fs.existsSync(deployDir)
    ? fs.readdirSync(deployDir)
        .filter(name => /^lingbi-studio-linux-.*\.tar\.gz$/i.test(name))
        .map(name => path.join(deployDir, name))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    : [];
  assert(files.length > 0, 'No .deploy/lingbi-studio-linux-*.tar.gz package found. Run pnpm package:linux first.');
  return files[0];
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listArchive(archive) {
  const tar = spawnSync('tar', ['-tzf', archive], { cwd: deployDir, encoding: 'utf8' });
  assert(tar.status === 0, `tar -tzf failed: ${tar.stderr || tar.error?.message || 'unknown error'}`);
  return tar.stdout.split(/\r?\n/).filter(Boolean);
}

function collectFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        out.push(full);
      }
    }
  }
  return out;
}

function scanSecrets(stagingDir) {
  const secretPattern = /ark-[A-Za-z0-9-]{30,}|sk-[A-Za-z0-9]{12,}/g;
  const hits = [];
  for (const file of collectFiles(stagingDir)) {
    const rel = path.relative(stagingDir, file).replaceAll('\\', '/');
    if (rel === 'pnpm-lock.yaml') continue;
    if (rel.includes('/node_modules/') || rel.includes('/.next/')) continue;
    if (fs.statSync(file).size > 2_000_000) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(secretPattern)) {
      const value = match[0];
      hits.push({
        file: rel,
        kind: value === 'sk-test' || value === 'sk-secret-123' ? 'allowed-test-fixture' : 'possible-secret',
        sample: value.startsWith('sk-') ? `${value.slice(0, 7)}...` : `${value.slice(0, 8)}...`,
      });
    }
  }
  return hits;
}

function main() {
  const archive = findLatestArchive();
  const bundleName = path.basename(archive, '.tar.gz');
  const stagingDir = path.join(deployDir, bundleName, 'lingbi-studio');
  assert(fs.existsSync(stagingDir), `Staging dir not found for latest package: ${stagingDir}. Re-run pnpm package:linux.`);

  const archiveEntries = listArchive(archive);
  const packageJson = readJson(path.join(stagingDir, 'package.json'));
  const manifest = readJson(path.join(stagingDir, 'BUNDLE_MANIFEST.json'));
  const readme = fs.readFileSync(path.join(stagingDir, 'README-LINUX.md'), 'utf8');
  const envTemplate = fs.readFileSync(path.join(stagingDir, '.env.real.local.example'), 'utf8');

  const missingScripts = requiredScripts.filter(name => !packageJson.scripts?.[name]);
  const missingFiles = requiredFiles.filter(rel => !fs.existsSync(path.join(stagingDir, rel)));
  const missingManifestCommands = requiredScripts
    .filter(name => name.startsWith('smoke:') || name === 'audit:pptx-quality')
    .filter(name => !(manifest.realSmokeCommands || []).some(command => command.includes(name)));
  const missingDocumentationArtifacts = [
    'docs/api-conventions.md',
  ].filter(name => !(manifest.documentationArtifacts || []).includes(name));
  const missingReadmeCommands = [
    'pnpm smoke:real-env-preflight',
    'pnpm smoke:real-openai-compatible',
    'pnpm smoke:real-app-ai',
    'pnpm smoke:real-studio-products',
  ].filter(command => !readme.includes(command));
  const missingTtsEnv = [
    'AGENTPLAN_TTS_ENDPOINT',
    'AGENTPLAN_TTS_RESOURCE_ID',
    'AGENTPLAN_TTS_SPEAKER',
    'AGENTPLAN_TTS_API_KEY',
  ].filter(name => !envTemplate.includes(name));
  const forbiddenEntries = archiveEntries.filter(entry =>
    /\.env\.real\.local$/i.test(entry)
    || entry.includes('/.data/')
    || entry.includes('/.logs/')
    || entry.includes('/public/uploads/')
    || entry.includes('/public/mineru-figures/')
  );
  const secretHits = scanSecrets(stagingDir);
  const possibleSecrets = secretHits.filter(hit => hit.kind === 'possible-secret');
  const releaseGateTest = spawnSync(process.execPath, ['scripts/test-release-env-gate.mjs'], {
    cwd: stagingDir,
    encoding: 'utf8',
  });
  const releaseGateTestError = releaseGateTest.status === 0
    ? null
    : releaseGateTest.stderr || releaseGateTest.stdout || releaseGateTest.error?.message || 'unknown error';

  const ok = missingScripts.length === 0
    && missingFiles.length === 0
    && missingManifestCommands.length === 0
    && missingDocumentationArtifacts.length === 0
    && missingReadmeCommands.length === 0
    && missingTtsEnv.length === 0
    && forbiddenEntries.length === 0
    && possibleSecrets.length === 0
    && releaseGateTest.status === 0;

  console.log(JSON.stringify({
    ok,
    archive,
    archiveBytes: fs.statSync(archive).size,
    stagingDir,
    checked: [
      'latest Linux package can be listed by tar',
      'package scripts include real model, Doubao AgentPlan TTS, Studio UI, evidence UI, PPTX quality, runtime health, and validate gates',
      'BUNDLE_MANIFEST realSmokeCommands include product-path commands',
      'README-LINUX includes server real-smoke operator flow',
      '.env.real.local.example includes Doubao AgentPlan TTS contract without secrets',
      'archive excludes .env.real.local, .data, and .logs',
      'packaged files include Studio product and PPTX audit scripts',
      'packaged files include API conventions docs for release/source parity',
      'packaged release environment gate executes without source-only CI files',
      'packaged tree secret scan has no possible real keys',
    ],
    missingScripts,
    missingFiles,
    missingManifestCommands,
    missingDocumentationArtifacts,
    missingReadmeCommands,
    missingTtsEnv,
    forbiddenEntries,
    releaseGateTestError,
    secretHits,
  }, null, 2));

  if (!ok) process.exit(1);
}

main();
