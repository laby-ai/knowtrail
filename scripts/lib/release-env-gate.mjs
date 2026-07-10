import { randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

export const REQUIRED_ENV_GROUPS = [
  { name: 'model-api-base', keys: ['OPENAI_COMPAT_API_BASE', 'ARK_API_BASE', 'OPENAI_API_BASE'] },
  { name: 'model-api-key', keys: ['OPENAI_COMPAT_API_KEY', 'ARK_API_KEY', 'OPENAI_API_KEY'] },
  { name: 'model-name', keys: ['OPENAI_COMPAT_MODEL', 'ARK_MODEL'] },
  { name: 'account-api-base', keys: ['ACCOUNT_CENTER_API_BASE'] },
  { name: 'account-tenant', keys: ['ACCOUNT_CENTER_TENANT_ID'] },
  { name: 'account-member', keys: ['ACCOUNT_CENTER_DEFAULT_MEMBER_ID'] },
  { name: 'account-app-key', keys: ['ACCOUNT_CENTER_APP_KEY'] },
  { name: 'account-credential-key', keys: ['ACCOUNT_CENTER_CREDENTIAL_KEY'] },
  { name: 'account-client-secret', keys: ['ACCOUNT_CENTER_CLIENT_SECRET'] },
  { name: 'account-auth-required', keys: ['ACCOUNT_CENTER_REQUIRE_AUTH'], expectedValue: 'true' },
  { name: 'source-store', keys: ['SOURCE_STORE_PATH'] },
  { name: 'vector-store', keys: ['ZVEC_STORE_PATH'] },
  { name: 'studio-job-store', keys: ['STUDIO_JOB_STORE_PATH'] },
  { name: 'scientific-illustration-store', keys: ['SCIENTIFIC_ILLUSTRATION_STORE_DIR'] },
];

function parseEnv(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const raw = match[2].trim();
    const value = raw.replace(/^(['"])(.*)\1$/, '$2').trim();
    values.set(match[1], value);
  }
  return values;
}

function missingRequiredGroups(values, groups = REQUIRED_ENV_GROUPS) {
  return groups.filter(group => {
    const present = group.keys.some(key => {
      const value = values.get(key);
      return value && (!group.expectedValue || value === group.expectedValue);
    });
    return !present;
  }).map(group => group.name);
}

export async function prepareReleaseEnvironment({ sourcePath, targetPath, requiredGroups = REQUIRED_ENV_GROUPS }) {
  const sourceStat = await stat(sourcePath).catch(() => null);
  if (!sourceStat?.isFile()) throw new Error(`Stable release environment file is missing: ${sourcePath}`);
  if (process.platform !== 'win32' && (sourceStat.mode & 0o077) !== 0) {
    throw new Error('Stable release environment file must not be readable or writable by group/other users.');
  }
  if (typeof process.getuid === 'function' && process.getuid() === 0 && sourceStat.uid !== 0) {
    throw new Error('Stable release environment file must be owned by root when the release gate runs as root.');
  }

  const text = await readFile(sourcePath, 'utf8');
  const missingGroups = missingRequiredGroups(parseEnv(text), requiredGroups);
  if (missingGroups.length > 0) {
    throw new Error(`Stable release environment is missing required groups: ${missingGroups.join(', ')}`);
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp-${randomUUID()}`;
  try {
    await copyFile(sourcePath, temporaryPath);
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  const targetStat = await stat(targetPath);
  if (process.platform !== 'win32' && (targetStat.mode & 0o777) !== 0o600) {
    throw new Error('Candidate release environment mode is not 0600.');
  }
  if (process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() === 0 && targetStat.uid !== 0) {
    throw new Error('Candidate release environment must be owned by root.');
  }

  return {
    ok: true,
    sourcePath: path.resolve(sourcePath),
    targetPath: path.resolve(targetPath),
    targetMode: '0600',
    checkedGroups: requiredGroups.map(group => group.name),
    missingGroups,
  };
}

function isInsideSharedRoot(value, sharedRoot) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const root = path.posix.normalize(sharedRoot).replace(/\/$/, '');
  const target = path.posix.normalize(value);
  return target === root || target.startsWith(`${root}/`);
}

export function validateReleaseHealth(body, { sharedRoot }) {
  const failures = [];
  const capabilities = body?.capabilities || {};
  if (body?.ok !== true) failures.push('health.ok must be true');
  if (capabilities.accountBoundModelConfig !== true) failures.push('accountBoundModelConfig must be true');
  if (capabilities.serverFallbackModelConfigured !== true) failures.push('serverFallbackModelConfigured must be true');
  if (capabilities.accountCenter?.billingReservationReady !== true) failures.push('billingReservationReady must be true');

  for (const [name, value] of [
    ['sourceStore', capabilities.sourceStore?.path],
    ['vectorStore', capabilities.vectorStore?.path],
    ['studioJobStore', capabilities.studioJobStore?.path],
    ['scientificIllustrationStore', capabilities.scientificIllustrationStore?.path],
  ]) {
    if (!isInsideSharedRoot(value, sharedRoot)) failures.push(`${name} path must stay inside shared root`);
  }
  if (capabilities.scientificIllustrationStore?.writable !== true) {
    failures.push('scientificIllustrationStore must be writable');
  }
  if (failures.length > 0) throw new Error(`Release health gate failed: ${failures.join('; ')}`);

  return {
    ok: true,
    service: body.service,
    modelReady: true,
    billingReady: true,
    sharedRoot: path.posix.normalize(sharedRoot),
    stores: {
      sourceStore: capabilities.sourceStore.path,
      vectorStore: capabilities.vectorStore.path,
      studioJobStore: capabilities.studioJobStore.path,
      scientificIllustrationStore: capabilities.scientificIllustrationStore.path,
    },
  };
}

export async function promoteReleaseWithRollback({
  releaseDir,
  getCurrent,
  setCurrent,
  setPrevious,
  restart,
  verify,
}) {
  const oldRelease = await getCurrent();
  await setPrevious(oldRelease);
  await setCurrent(releaseDir);
  try {
    await restart();
    await verify();
    return { ok: true, oldRelease, releaseDir };
  } catch (error) {
    await setCurrent(oldRelease);
    await restart();
    await verify();
    throw error;
  }
}
