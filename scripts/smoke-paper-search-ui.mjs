import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const workspace = process.cwd();
const startupTimeoutMs = 60_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === 'string') return reject(new Error('Unable to allocate a free port.'));
        resolve(address.port);
      });
    });
  });
}

function killProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

async function waitForHealth(origin, child, output) {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`App exited with code ${child.exitCode}: ${output.join('').slice(-3000)}`);
    try {
      const response = await fetch(`${origin}/api/health`, { cache: 'no-store' });
      if (response.ok && (await response.json()).ok === true) return;
    } catch {
      // Keep waiting for the managed app.
    }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error(`Timed out waiting for ${origin}/api/health: ${output.join('').slice(-3000)}`);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function startFakeMetaso() {
  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const requests = [];
  const server = http.createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/search') {
      const body = await readJsonBody(request);
      requests.push(body);
      if (body.q === 'force-error') {
        response.writeHead(429, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: 'rate limited' }));
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 350));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        scholars: body.q === 'no-results' ? [] : [{
          title: 'Evidence Synthesis Methods',
          link: `${origin}/paper/evidence-synthesis`,
          snippet: 'A reproducible method for evidence synthesis with explicit source verification.',
          date: '2025-05-18',
          authors: ['Ada Researcher', 'Lin Scholar'],
          score: '0.92',
        }],
        total: body.q === 'no-results' ? 0 : 1,
      }));
      return;
    }
    if (request.method === 'GET' && request.url === '/paper/evidence-synthesis') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<html><head><title>Evidence Synthesis Methods</title></head><body><main><h1>Evidence Synthesis Methods</h1><p>This source describes a reproducible evidence synthesis method. It records search terms, source metadata, verification status, limitations, and the reasoning used to include or exclude each candidate paper.</p></main></body></html>');
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { server, origin, requests };
}

async function closeServer(server) {
  if (!server) return;
  await new Promise(resolve => server.close(resolve));
}

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-paper-search-'));
  const evidenceDir = path.join(workspace, 'output', 'playwright');
  await mkdir(evidenceDir, { recursive: true });
  const uploadDir = path.join(workspace, 'public', 'uploads');
  await mkdir(uploadDir, { recursive: true });
  const uploadsBefore = new Set(await readdir(uploadDir));
  let fakeMetaso;
  let child;
  let browser;

  try {
    fakeMetaso = await startFakeMetaso();
    const appPort = await findFreePort();
    const appOrigin = `http://127.0.0.1:${appPort}`;
    const output = [];
    child = spawn(process.execPath, ['scripts/dev.mjs'], {
      cwd: workspace,
      env: {
        ...process.env,
        PORT: String(appPort),
        DEPLOY_RUN_PORT: String(appPort),
        INTERNAL_APP_ORIGIN: '',
        ACCOUNT_CENTER_REQUIRE_AUTH: 'false',
        METASO_API_BASE: fakeMetaso.origin,
        METASO_API_KEY: 'paper-search-smoke',
        SOURCE_STORE_PATH: path.join(tempDir, 'sources.json'),
        ZVEC_STORE_PATH: path.join(tempDir, 'zvec'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    child.stdout.on('data', chunk => output.push(String(chunk)));
    child.stderr.on('data', chunk => output.push(String(chunk)));
    await waitForHealth(appOrigin, child, output);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const consoleErrors = [];
    page.on('pageerror', error => consoleErrors.push(error.message));
    await page.goto(`${appOrigin}/#workbench`, { waitUntil: 'networkidle' });
    await page.getByTestId('paper-search-panel').waitFor({ state: 'visible' });
    assert(await page.getByTestId('discover-scope-scholar').getAttribute('class').then(value => value?.includes('glass-active')), 'Paper search did not default to scholar scope.');

    await page.getByTestId('discover-query').fill('evidence synthesis');
    await page.getByTestId('discover-search').click();
    await page.getByText('正在搜索学术文献线索...').waitFor({ state: 'visible' });
    await page.getByText('Evidence Synthesis Methods', { exact: true }).waitFor({ state: 'visible' });
    await page.getByText('待核验', { exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('link', { name: '查看来源' }).waitFor({ state: 'visible' });
    const desktopScreenshot = path.join(evidenceDir, 'paper-search-desktop.png');
    await page.screenshot({ path: desktopScreenshot, fullPage: true });

    await page.getByTestId('discover-result-item').click();
    await page.getByTestId('discover-ingest').click();
    await page.getByTestId('discover-notice').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('paper-search-upload-summary').waitFor({ state: 'visible' });
    await page.locator('[data-testid^="library-paper-"]').filter({ hasText: 'Evidence Synthesis Methods' }).waitFor({ state: 'visible' });
    await page.getByTestId('library-selection-count').filter({ hasText: /已选 1 个文献来源|已选 1 篇/ }).waitFor({ state: 'visible' });

    await page.getByTestId('discover-query').fill('no-results');
    await page.getByTestId('discover-search').click();
    await page.getByText('没有找到相关结果，换个关键词试试。').waitFor({ state: 'visible' });

    await page.getByTestId('discover-query').fill('force-error');
    await page.getByTestId('discover-search').click();
    await page.getByText(/搜索服务暂不可用\(HTTP 429\)/).waitFor({ state: 'visible' });

    await page.getByTestId('library-discover').click();
    const libraryModal = page.getByTestId('discover-sources-modal');
    await libraryModal.waitFor({ state: 'visible' });
    await libraryModal.getByRole('button', { name: '关闭' }).click();
    await libraryModal.waitFor({ state: 'detached' });

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const mobileErrors = [];
    mobile.on('pageerror', error => mobileErrors.push(error.message));
    await mobile.goto(`${appOrigin}/#workbench`, { waitUntil: 'networkidle' });
    await mobile.getByTestId('workbench-mobile-tab-right').click();
    await mobile.getByTestId('paper-search-panel').waitFor({ state: 'visible' });
    await mobile.getByTestId('discover-query').fill('evidence synthesis');
    await mobile.getByTestId('discover-search').click();
    await mobile.getByText('Evidence Synthesis Methods', { exact: true }).waitFor({ state: 'visible' });
    await mobile.getByText('待核验', { exact: true }).waitFor({ state: 'visible' });
    const mobileOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const mobileScreenshot = path.join(evidenceDir, 'paper-search-mobile.png');
    await mobile.screenshot({ path: mobileScreenshot, fullPage: true });
    await mobile.close();

    assert(fakeMetaso.requests.length === 4, `Expected 4 search requests, got ${fakeMetaso.requests.length}.`);
    assert(fakeMetaso.requests.every(request => request.scope === 'scholar'), 'Search route did not preserve scholar scope.');
    assert(consoleErrors.length === 0, `Browser errors: ${consoleErrors.join(' | ')}`);
    assert(mobileErrors.length === 0, `Mobile browser errors: ${mobileErrors.join(' | ')}`);
    assert(!mobileOverflow, 'Paper search caused horizontal overflow on mobile.');
    const evidence = {
      ok: true,
      appOrigin,
      providerRequests: fakeMetaso.requests.map(request => ({ q: request.q, scope: request.scope })),
      screenshots: { desktop: desktopScreenshot, mobile: mobileScreenshot },
      mobileOverflow,
      checked: [
        'paper-search product opens a real embedded scholar search workspace',
        'loading, result metadata, verification status, and source link render',
        'selected source follows discover/fetch/upload and appears selected in the library',
        'empty and provider-error states render without simulated product success',
        'the existing Library discover modal still opens and closes after component reuse',
      ],
    };
    await writeFile(path.join(evidenceDir, 'paper-search-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8');
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await browser?.close().catch(() => undefined);
    killProcessTree(child);
    await closeServer(fakeMetaso?.server);
    const uploadsAfter = await readdir(uploadDir).catch(() => []);
    await Promise.all(uploadsAfter
      .filter(entry => !uploadsBefore.has(entry))
      .map(entry => unlink(path.join(uploadDir, entry)).catch(() => undefined)));
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
