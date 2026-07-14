import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => typeof address === 'object' && address
        ? resolve(address.port)
        : reject(new Error('No smoke port available.')));
    });
  });
}

function stop(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

async function waitForHealth(origin, child, output) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Smoke app exited with ${child.exitCode}: ${output.join('').slice(-3000)}`);
    }
    try {
      const response = await fetch(`${origin}/api/health`, { cache: 'no-store' });
      if (response.ok && (await response.json()).ok === true) return;
    } catch {
      // The local Next.js process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Smoke app health timed out: ${output.join('').slice(-3000)}`);
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'quiet-workbench-'));
const port = await findFreePort();
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['scripts/dev.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    DEPLOY_RUN_PORT: String(port),
    BIND_HOST: '127.0.0.1',
    SOURCE_STORE_PATH: path.join(tempDir, 'sources.json'),
    ZVEC_STORE_PATH: path.join(tempDir, 'zvec'),
    INTERNAL_APP_ORIGIN: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: false,
});
const output = [];
child.stdout.on('data', (chunk) => output.push(chunk.toString()));
child.stderr.on('data', (chunk) => output.push(chunk.toString()));

let browser;
try {
  await waitForHealth(origin, child, output);
  browser = await chromium.launch({ headless: true });

  const embedded = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await embedded.addInitScript(() => {
    window.__quietSeen = [];
    const record = () => {
      const text = document.body?.innerText || '';
      for (const value of ['开启科研模式', 'KnowTrail']) {
        if (text.includes(value) && !window.__quietSeen.includes(value)) window.__quietSeen.push(value);
      }
    };
    const observe = () => {
      record();
      new MutationObserver(record).observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.documentElement) observe();
    else window.addEventListener('DOMContentLoaded', observe, { once: true });
  });

  const query = new URLSearchParams({
    host: 'paper-web',
    hostBridge: 'postMessage',
    workspaceKey: 'guest-session-quiet-01',
    accountScope: 'guest',
    embed: 'research-agent',
    hideVirtualClassroom: '1',
    view: 'notebooks',
  });
  await embedded.goto(`${origin}/?${query}#notebooks`, { waitUntil: 'networkidle' });
  await embedded.getByTestId('notebook-home-create').waitFor({ state: 'visible' });
  assert((await embedded.evaluate(() => window.__quietSeen)).length === 0, 'Embedded entry exposed marketing or KnowTrail branding.');

  const standalone = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await standalone.goto(origin, { waitUntil: 'networkidle' });
  await standalone.getByText('KnowTrail', { exact: true }).first().waitFor({ state: 'visible' });
  await standalone.getByText('开启科研模式', { exact: true }).waitFor({ state: 'visible' });

  await embedded.getByTestId('notebook-home-create').click();
  await embedded.getByTestId('workbench-topbar-title').waitFor({ state: 'visible' });
  assert(await embedded.getByText('KnowTrail', { exact: true }).count() === 0, 'Embedded workbench exposed KnowTrail branding.');

  console.log(JSON.stringify({
    ok: true,
    checked: ['no embedded landing flash', 'no embedded brand', 'standalone brand retained'],
  }));
} finally {
  await browser?.close().catch(() => undefined);
  stop(child);
  await rm(tempDir, { recursive: true, force: true });
}
