import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  prepareReleaseEnvironment,
  promoteReleaseWithRollback,
  validateReleaseHealth,
} from './lib/release-env-gate.mjs';
import { applyClipboardModelSecrets } from './lib/real-env-setup.mjs';

const fakeSecret = 'test-only-secret-value';
const validEnv = [
  `KNOWTRAIL_OBSERVABILITY_HASH_KEY=${fakeSecret.repeat(2)}`,
  'OPENAI_COMPAT_API_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1',
  `OPENAI_COMPAT_API_KEY=${fakeSecret}`,
  'OPENAI_COMPAT_MODEL=qwen3.7-plus',
  `DASHSCOPE_API_KEY=${fakeSecret}`,
  'DASHSCOPE_IMAGE_MODEL=qwen-image-2.0',
  'LOCAL_USAGE_QUOTA_PATH=/opt/knowtrail/shared/usage/usage.json',
  'SOURCE_STORE_PATH=/opt/knowtrail/shared/sources/sources.json',
  'LOCAL_FILE_STORAGE_DIR=/opt/knowtrail/shared/uploads',
  'ZVEC_STORE_PATH=/opt/knowtrail/shared/zvec',
  'STUDIO_JOB_STORE_PATH=/opt/knowtrail/shared/studio-jobs/jobs.json',
  'SCIENTIFIC_ILLUSTRATION_STORE_DIR=/opt/knowtrail/shared/scientific-illustrations',
  '',
].join('\n');

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-release-env-gate-'));
try {
  const clipboardValues = new Map();
  const fakeBailianKey = ['sk', 'testonly0123456789abcdef'].join('-');
  const fakeSitianToken = [
    'eyJ0ZXN0IjoidHJ1ZSJ9',
    'eyJzdWIiOiJmaXh0dXJlIn0',
    'fixture-signature',
  ].join('.');
  const clipboardSummary = applyClipboardModelSecrets(
    clipboardValues,
    `${fakeBailianKey} ${fakeSitianToken}`,
  );
  assert.equal(clipboardValues.get('OPENAI_COMPAT_MODEL'), 'qwen3.7-plus');
  assert.equal(clipboardValues.get('DASHSCOPE_IMAGE_MODEL'), 'qwen-image-2.0');
  assert(!JSON.stringify(clipboardSummary).includes(fakeBailianKey));
  assert(!JSON.stringify(clipboardSummary).includes(fakeSitianToken));

  const sourcePath = path.join(tempDir, 'stable.env');
  const targetPath = path.join(tempDir, 'release', '.env.production');
  await writeFile(sourcePath, validEnv, 'utf8');
  await chmod(sourcePath, 0o600);

  const summary = await prepareReleaseEnvironment({ sourcePath, targetPath });
  assert.equal(await readFile(targetPath, 'utf8'), validEnv);
  if (process.platform !== 'win32') {
    assert.equal((await stat(targetPath)).mode & 0o777, 0o600);
  }
  assert(!JSON.stringify(summary).includes(fakeSecret), 'Release preparation must never return secret values.');
  assert.deepEqual(summary.missingGroups, []);

  const incompletePath = path.join(tempDir, 'incomplete.env');
  await writeFile(incompletePath, validEnv.replace(/^OPENAI_COMPAT_API_KEY=.*\n/m, ''), 'utf8');
  await chmod(incompletePath, 0o600);
  await assert.rejects(
    () => prepareReleaseEnvironment({ sourcePath: incompletePath, targetPath }),
    error => {
      assert.match(String(error), /model-api-key/);
      assert(!String(error).includes(fakeSecret));
      return true;
    },
  );

  const missingObservabilityKeyPath = path.join(tempDir, 'missing-observability-key.env');
  await writeFile(
    missingObservabilityKeyPath,
    validEnv.replace(/^KNOWTRAIL_OBSERVABILITY_HASH_KEY=.*\n/m, ''),
    'utf8',
  );
  await chmod(missingObservabilityKeyPath, 0o600);
  await assert.rejects(
    () => prepareReleaseEnvironment({ sourcePath: missingObservabilityKeyPath, targetPath }),
    /observability-identity-hash-key/,
  );

  const missingImageProviderPath = path.join(tempDir, 'missing-image-provider.env');
  await writeFile(
    missingImageProviderPath,
    validEnv.replace(/^DASHSCOPE_API_KEY=.*\n/m, ''),
    'utf8',
  );
  await chmod(missingImageProviderPath, 0o600);
  await assert.rejects(
    () => prepareReleaseEnvironment({ sourcePath: missingImageProviderPath, targetPath }),
    /bailian-image-api-key/,
  );

  const health = {
    ok: true,
    capabilities: {
      accountBoundModelConfig: true,
      serverFallbackModelConfigured: true,
      bailianImageProviderConfigured: true,
      vectorStore: { path: '/opt/knowtrail/shared/zvec' },
      sourceStore: { path: '/opt/knowtrail/shared/sources/sources.json' },
      localUploadStore: { path: '/opt/knowtrail/shared/uploads', writable: true },
      studioJobStore: { path: '/opt/knowtrail/shared/studio-jobs/jobs.json' },
      scientificIllustrationStore: {
        path: '/opt/knowtrail/shared/scientific-illustrations',
        writable: true,
      },
      accountCenter: { billingReservationReady: true },
    },
  };
  const healthSummary = validateReleaseHealth(health, { sharedRoot: '/opt/knowtrail/shared' });
  assert.equal(healthSummary.ok, true);
  assert(!JSON.stringify(healthSummary).includes(fakeSecret));

  assert.throws(
    () => validateReleaseHealth({
      ...health,
      capabilities: { ...health.capabilities, serverFallbackModelConfigured: false },
    }, { sharedRoot: '/opt/knowtrail/shared' }),
    /serverFallbackModelConfigured/,
  );
  assert.throws(
    () => validateReleaseHealth({
      ...health,
      capabilities: { ...health.capabilities, bailianImageProviderConfigured: false },
    }, { sharedRoot: '/opt/knowtrail/shared' }),
    /bailianImageProviderConfigured/,
  );
  assert.throws(
    () => validateReleaseHealth({
      ...health,
      capabilities: {
        ...health.capabilities,
        sourceStore: { path: '/opt/knowtrail/releases/candidate/.data/sources.json' },
      },
    }, { sharedRoot: '/opt/knowtrail/shared' }),
    /sourceStore.*shared root/,
  );
  assert.throws(
    () => validateReleaseHealth({
      ...health,
      capabilities: {
        ...health.capabilities,
        scientificIllustrationStore: {
          path: '/opt/knowtrail/shared/scientific-illustrations',
          writable: false,
        },
      },
    }, { sharedRoot: '/opt/knowtrail/shared' }),
    /scientificIllustrationStore.*writable/,
  );

  const state = { current: '/releases/old', previous: '', restarts: 0, verified: 0 };
  await assert.rejects(
    () => promoteReleaseWithRollback({
      releaseDir: '/releases/new',
      getCurrent: async () => state.current,
      setCurrent: async value => { state.current = value; },
      setPrevious: async value => { state.previous = value; },
      restart: async () => { state.restarts += 1; },
      verify: async () => {
        state.verified += 1;
        if (state.verified === 1) throw new Error('live health failed');
      },
    }),
    /live health failed/,
  );
  assert.deepEqual(state, {
    current: '/releases/old',
    previous: '/releases/old',
    restarts: 2,
    verified: 2,
  });

  const healthRouteSource = await readFile(path.join(process.cwd(), 'src/app/api/health/route.ts'), 'utf8');
  const deploySource = await readFile(path.join(process.cwd(), 'deploy/linux/deploy.sh'), 'utf8');
  const installSource = await readFile(path.join(process.cwd(), 'deploy/linux/install.sh'), 'utf8');
  const packageSource = await readFile(path.join(process.cwd(), 'scripts/package-linux.mjs'), 'utf8');
  const packageJson = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'));
  const ciSource = await readFile(path.join(process.cwd(), '.github/workflows/ci.yml'), 'utf8')
    .catch(error => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
  const packageSmokeSource = await readFile(path.join(process.cwd(), 'scripts/smoke-linux-package-products.mjs'), 'utf8');
  const releaseGateSource = await readFile(path.join(process.cwd(), 'scripts/lib/release-env-gate.mjs'), 'utf8');
  const promoteSource = await readFile(path.join(process.cwd(), 'scripts/promote-release.mjs'), 'utf8');
  assert.match(healthRouteSource, /scientificIllustrationStore/);
  assert.match(deploySource, /prepare-release-env/);
  assert.match(deploySource, /verify-release-health/);
  assert.match(installSource, /tar -tzf "\$CLASSROOM_RUNTIME_ARCHIVE" \| sed 's#\^\\\.\/#\#'/);
  assert.match(installSource, /tar -xzf "\$CLASSROOM_RUNTIME_ARCHIVE"[\s\S]*rm -f "\$CLASSROOM_RUNTIME_ARCHIVE"/, 'Installed classroom runtime archives must not remain duplicated inside a release.');
  assert.doesNotMatch(installSource, /printf '%s\\n'.*\| grep -[EF]q/);
  assert.match(installSource, /grep -Fq "\$required" <<< "\$CLASSROOM_RUNTIME_ENTRIES"/);
  assert.match(installSource, /OpenMAIC runtime archive contains an unsafe path/);
  assert.match(installSource, /OpenMAIC runtime archive did not produce a standalone server/);
  assert.match(packageSource, /spawnSync\('tar', \['-tzf', archivePath\],[\s\S]*maxBuffer:\s*32 \* 1024 \* 1024/, 'Packaging must inspect a real classroom runtime without relying on spawnSync default output limits.');
  assert(
    deploySource.indexOf('command -v node') < deploySource.indexOf('prepare-release-env'),
    'The release env CLI must run only after Node bootstrap is available.',
  );
  assert(
    deploySource.indexOf('prepare-release-env') < deploySource.indexOf('run_script "$APP_DIR/install.sh"'),
    'The release env must be prepared before install can create an example env.',
  );
  assert.equal(packageJson.scripts['test:release-env-gate'], 'node ./scripts/test-release-env-gate.mjs');
  assert.match(packageJson.scripts.validate, /test:release-env-gate/);
  if (ciSource !== null) {
    assert.match(ciSource, /Release environment gate[\s\S]*test:release-env-gate/);
  }
  for (const packagedGate of [
    'scripts/prepare-release-env.mjs',
    'scripts/verify-release-health.mjs',
    'scripts/promote-release.mjs',
    'scripts/lib/release-env-gate.mjs',
    'scripts/test-release-env-gate.mjs',
  ]) {
    assert(packageSmokeSource.includes(packagedGate), `${packagedGate} must be enforced by package smoke.`);
  }
  assert.match(releaseGateSource, /sourceStat\.uid/);
  assert.match(promoteSource, /RELEASE_STANDBY_PID_FILE/);
  assert.match(promoteSource, /\/proc\/\$\{pid\}\/cwd/);
  assert.match(promoteSource, /process\.kill\(-pid/);

  console.log(JSON.stringify({
    ok: true,
    checked: [
      'stable env is copied atomically with mode 0600 and no secret values in summaries',
      'missing required configuration fails before service changes',
      'standby health requires model, billing, shared stores, and writable illustration storage',
      'failed live verification restores the previous release and restarts it',
      'health and deploy scripts expose the release gate contract',
      'CI and aggregate validation enforce the release gate contract',
      'Linux package smoke requires every release gate entrypoint',
      'Linux install normalizes and validates the nested classroom runtime archive before extraction',
      'promotion safely stops the verified standby process group before switching links',
    ],
  }, null, 2));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
