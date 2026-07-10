import { randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, rename, stat, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { promoteReleaseWithRollback, validateReleaseHealth } from './lib/release-env-gate.mjs';

const [releaseDir, currentLink, previousLink] = process.argv.slice(2);
const serviceName = process.env.RELEASE_SERVICE_NAME || 'knowtrail';
const standbyOrigin = (process.env.RELEASE_STANDBY_ORIGIN || '').replace(/\/$/, '');
const liveOrigin = (process.env.RELEASE_LIVE_ORIGIN || 'http://127.0.0.1:5000').replace(/\/$/, '');
const sharedRoot = process.env.RELEASE_SHARED_ROOT || '/opt/knowtrail/shared';
const standbyPidFile = process.env.RELEASE_STANDBY_PID_FILE || '';

if (!releaseDir || !currentLink || !previousLink || !standbyOrigin || !standbyPidFile) {
  console.error('Usage: RELEASE_STANDBY_ORIGIN=http://127.0.0.1:5099 RELEASE_STANDBY_PID_FILE=/run/lingbi-standby.pid node scripts/promote-release.mjs <release-dir> <current-link> <previous-link>');
  process.exit(2);
}

async function fetchValidatedHealth(origin, { attempts = 1, delayMs = 1_000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(15_000) });
      const body = await response.json();
      if (!response.ok) throw new Error(`Health endpoint returned HTTP ${response.status}`);
      return validateReleaseHealth(body, { sharedRoot });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

async function replaceLink(linkPath, target) {
  const tempLink = `${linkPath}.tmp-${randomUUID()}`;
  await symlink(target, tempLink, 'dir');
  try {
    await rename(tempLink, linkPath);
  } catch (error) {
    await unlink(tempLink).catch(() => undefined);
    throw error;
  }
}

function restartService() {
  const result = spawnSync('systemctl', ['restart', serviceName], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`systemctl restart ${serviceName} failed`);
}

async function stopVerifiedStandby() {
  const rawPid = (await readFile(standbyPidFile, 'utf8')).trim();
  const pid = Number(rawPid);
  if (!Number.isInteger(pid) || pid <= 1) throw new Error('Standby PID file is invalid.');
  const expectedCwd = await realpath(releaseDir);
  const actualCwd = await realpath(`/proc/${pid}/cwd`).catch(() => '');
  if (actualCwd !== expectedCwd) throw new Error('Standby PID does not belong to the candidate release.');

  try {
    process.kill(-pid, 'SIGTERM');
  } catch (error) {
    if (error?.code === 'ESRCH') {
      await unlink(standbyPidFile).catch(() => undefined);
      return;
    }
    throw error;
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      await unlink(standbyPidFile).catch(() => undefined);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  process.kill(-pid, 'SIGKILL');
  await unlink(standbyPidFile).catch(() => undefined);
}

try {
  const releaseStat = await stat(releaseDir);
  if (!releaseStat.isDirectory()) throw new Error('Release directory is not a directory.');
  const envStat = await stat(path.join(releaseDir, '.env.production'));
  if (!envStat.isFile() || (envStat.mode & 0o777) !== 0o600) {
    throw new Error('Release .env.production must be a regular file with mode 0600.');
  }
  if (!(await lstat(currentLink)).isSymbolicLink()) throw new Error('Current release path must be a symlink.');

  const standby = await fetchValidatedHealth(standbyOrigin);
  await stopVerifiedStandby();
  const result = await promoteReleaseWithRollback({
    releaseDir: await realpath(releaseDir),
    getCurrent: async () => realpath(currentLink),
    setCurrent: async target => replaceLink(currentLink, target),
    setPrevious: async target => replaceLink(previousLink, target),
    restart: async () => restartService(),
    verify: async () => fetchValidatedHealth(liveOrigin, { attempts: 30 }),
  });
  console.log(JSON.stringify({ ...result, standby }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
