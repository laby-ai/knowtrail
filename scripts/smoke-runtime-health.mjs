import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import process from 'node:process';

const workspace = process.env.APP_WORKSPACE_PATH || process.cwd();
const startupTimeoutMs = Number(process.env.RUNTIME_HEALTH_SMOKE_TIMEOUT_MS || 20_000);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('Unable to allocate a local runtime smoke port.'));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function waitForHealth(origin, child) {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError = '';

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Runtime server exited before health check completed with code ${child.exitCode}.`);
    }

    try {
      const response = await fetch(`${origin}/api/health`, { cache: 'no-store' });
      const body = await response.json();
      if (response.ok) return { response, body };
      lastError = `HTTP ${response.status}: ${JSON.stringify(body)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for /api/health at ${origin}. Last error: ${lastError}`);
}

function killProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

async function main() {
  assert(existsSync(`${workspace}/dist/server.js`), 'dist/server.js is missing. Run pnpm build before pnpm smoke:runtime-health.');

  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['scripts/start.mjs'], {
    cwd: workspace,
    env: {
      ...process.env,
      PORT: String(port),
      DEPLOY_RUN_PORT: String(port),
      INTERNAL_APP_ORIGIN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  const output = [];
  child.stdout.on('data', chunk => output.push(String(chunk)));
  child.stderr.on('data', chunk => output.push(String(chunk)));

  try {
    const { body } = await waitForHealth(origin, child);
    assert(body.ok === true, `/api/health returned not ok: ${JSON.stringify(body)}`);
    assert(body.service === 'lingbi-studio', 'health response has unexpected service name.');
    assert(body.capabilities?.accountBoundModelConfig === true, 'health response does not advertise account-bound model config.');
    assert(body.capabilities?.userProvidedOpenAICompatibleConfig === false, 'health response should not advertise user-provided API config by default.');
    assert(body.capabilities?.vectorStore?.provider === 'zvec', 'health response does not expose zvec vector store.');
    assert(body.capabilities?.sourceStore?.provider, 'health response does not expose source store provider.');
    assert(body.capabilities?.studioJobStore?.provider === 'local-json', 'health response does not expose Studio job store provider.');
    assert(body.capabilities?.studioJobStore?.path, 'health response does not expose Studio job store path.');
    assert(['ilike', 'fts'].includes(body.capabilities?.sourceStore?.readyChunkSearch?.mode), 'health response does not expose ready chunk search mode.');
    assert(Number.isInteger(body.limits?.maxUploadBytes), 'health response does not expose maxUploadBytes.');
    assert(Number.isInteger(body.limits?.maxUploadFiles), 'health response does not expose maxUploadFiles.');

    console.log(JSON.stringify({
      ok: true,
      checked: [
        'cross-platform start wrapper',
        '/api/health ok response',
        'account-bound model config capability',
        'zvec vector store health',
        'source store health',
        'Studio job store health',
        'ready chunk search mode health',
        'upload limits health',
      ],
      origin,
      sourceStore: body.capabilities.sourceStore,
      studioJobStore: body.capabilities.studioJobStore,
      vectorStore: body.capabilities.vectorStore,
      limits: body.limits,
    }, null, 2));
  } catch (error) {
    const recentOutput = output.join('').slice(-4000);
    if (recentOutput) {
      console.error(recentOutput);
    }
    throw error;
  } finally {
    killProcessTree(child);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
