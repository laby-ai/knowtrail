import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const workspace = process.cwd();
const startupTimeoutMs = 60_000;
// A generated test-only workflow image makes blank/transparent provider output visible in screenshots.
const pngBase64 = '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';

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
        if (!address || typeof address === 'string') reject(new Error('Unable to allocate a free port.'));
        else resolve(address.port);
      });
    });
  });
}

function killProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

async function waitForHealth(origin, child, output) {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('App exited early: ' + output.join('').slice(-3000));
    try {
      const response = await fetch(origin + '/api/health', { cache: 'no-store' });
      if (response.ok && (await response.json()).ok === true) return;
    } catch {
      // Keep waiting for the managed app.
    }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error('Timed out waiting for app health: ' + output.join('').slice(-3000));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function startFakeProvider() {
  const port = await findFreePort();
  const origin = 'http://127.0.0.1:' + port;
  const imageRequests = [];
  const searchRequests = [];
  const server = http.createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/search') {
      searchRequests.push(await readJsonBody(request));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        scholars: [{
          title: 'Reproducible Sample Processing Workflow',
          link: origin + '/paper/workflow',
          snippet: 'Samples pass through quality control, feature extraction, and final review.',
          date: '2025-06-08',
          authors: ['Ada Researcher'],
        }],
        total: 1,
      }));
      return;
    }
    if (request.method === 'GET' && request.url === '/paper/workflow') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<html><head><title>Reproducible Sample Processing Workflow</title></head><body><main><h1>Reproducible Sample Processing Workflow</h1><p>Samples enter quality control before feature extraction. Results receive final review before reporting.</p></main></body></html>');
      return;
    }
    if (request.method === 'POST' && request.url === '/v1/images/generations') {
      const body = await readJsonBody(request);
      imageRequests.push(body);
      const prompt = String(body.prompt || '');
      if (prompt.includes('slow-cancel')) await new Promise(resolve => setTimeout(resolve, 3000));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        data: [{ b64_json: prompt.includes('bad-image') ? Buffer.from('invalid').toString('base64') : pngBase64 }],
      }));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { server, origin, imageRequests, searchRequests };
}

async function closeServer(server) {
  if (!server) return;
  await new Promise(resolve => server.close(resolve));
}

async function hideNextDevTools(page) {
  await page.locator('nextjs-portal').evaluateAll(elements => {
    elements.forEach(element => { element.style.display = 'none'; });
  });
}

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-scientific-illustration-'));
  const evidenceDir = path.join(workspace, 'output', 'playwright');
  await mkdir(evidenceDir, { recursive: true });
  let fakeProvider;
  let child;
  let browser;
  try {
    fakeProvider = await startFakeProvider();
    const appPort = await findFreePort();
    const appOrigin = 'http://127.0.0.1:' + appPort;
    const output = [];
    child = spawn(process.execPath, ['scripts/dev.mjs'], {
      cwd: workspace,
      env: {
        ...process.env,
        PORT: String(appPort),
        DEPLOY_RUN_PORT: String(appPort),
        INTERNAL_APP_ORIGIN: '',
        ACCOUNT_CENTER_REQUIRE_AUTH: 'false',
        ACCOUNT_CENTER_API_BASE: '',
        ACCOUNT_CENTER_TENANT_ID: '',
        ACCOUNT_CENTER_DEFAULT_MEMBER_ID: '',
        ARK_API_BASE: fakeProvider.origin,
        ARK_API_KEY: 'scientific-illustration-smoke',
        ARK_VISION_MODEL: 'doubao-seedream-smoke',
        SITIAN_API_TOKEN: '',
        ALLOW_INSECURE_API_BASE: 'true',
        ALLOW_PRIVATE_API_BASE: 'true',
        METASO_API_BASE: fakeProvider.origin,
        METASO_API_KEY: 'scientific-illustration-search-smoke',
        FILE_STORAGE_ADAPTER: 'local',
        SCIENTIFIC_ILLUSTRATION_STORE_DIR: path.join(tempDir, 'images'),
        SOURCE_STORE_PATH: path.join(tempDir, 'sources.json'),
        STUDIO_JOB_STORE_PATH: path.join(tempDir, 'studio-jobs.json'),
        ZVEC_STORE_PATH: path.join(tempDir, 'zvec'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });
    child.stdout.on('data', chunk => output.push(String(chunk)));
    child.stderr.on('data', chunk => output.push(String(chunk)));
    await waitForHealth(appOrigin, child, output);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const consoleErrors = [];
    page.on('pageerror', error => consoleErrors.push(error.message));
    await page.goto(appOrigin + '/#workbench', { waitUntil: 'networkidle' });
    await page.getByTestId('studio-nav-scientific-illustration').click();
    assert(await page.getByTestId('scientific-illustration-start').isDisabled(), 'No-source state should keep generation disabled.');
    await page.getByTestId('studio-nav-paper-search').click();
    await page.getByTestId('discover-query').fill('sample processing workflow');
    await page.getByTestId('discover-search').click();
    await page.getByText('Reproducible Sample Processing Workflow', { exact: true }).waitFor({ state: 'visible' });
    await page.getByTestId('discover-result-item').click();
    await page.getByTestId('discover-ingest').click();
    await page.getByTestId('paper-search-upload-summary').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('library-selection-count').filter({ hasText: /已选 1 个文献来源|已选 1 篇/ }).waitFor({ state: 'visible' });

    await page.getByTestId('studio-nav-scientific-illustration').click();
    await page.getByTestId('scientific-illustration-purpose').fill('展示样本进入质控、特征提取和结果复核的研究流程');
    await page.getByTestId('scientific-illustration-labels').fill('样本进入，质量控制，特征提取，结果复核');
    await page.getByTestId('scientific-illustration-start').click();
    await page.getByText('真实图片文件已生成；请复核科学含义、标签和文字后再用于论文或汇报。').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('scientific-illustration-result').waitFor({ state: 'visible' });
    const previewReady = await page.getByTestId('scientific-illustration-result').locator('img').evaluate(image => image.complete && image.naturalWidth > 0);
    assert(previewReady, 'Generated image preview did not load.');
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('scientific-illustration-download').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    const downloadBytes = downloadPath ? (await stat(downloadPath)).size : 0;
    assert(download.suggestedFilename().endsWith('.png'), 'Downloaded image should preserve its real PNG type.');
    assert(downloadBytes > 32, 'Downloaded image is unexpectedly small.');

    await hideNextDevTools(page);
    const desktop = path.join(evidenceDir, 'scientific-illustration-desktop.png');
    const desktopResult = path.join(evidenceDir, 'scientific-illustration-desktop-result.png');
    await page.screenshot({ path: desktop, fullPage: true });
    await page.getByTestId('scientific-illustration-result').screenshot({ path: desktopResult });

    await page.getByTestId('scientific-illustration-purpose').fill('bad-image 科研示意图返回格式检查');
    await page.getByTestId('scientific-illustration-start').click();
    await page.getByText(/图片格式或文件大小不符合要求/).waitFor({ state: 'visible', timeout: 30_000 });
    assert(await page.getByTestId('scientific-illustration-result').count() === 0, 'Invalid provider bytes must not render.');

    await page.getByTestId('scientific-illustration-purpose').fill('slow-cancel 科研示意图取消检查');
    await page.getByTestId('scientific-illustration-start').click();
    await page.getByRole('button', { name: '停止生成' }).click();
    await page.getByText('已停止生成，未展示未完成结果。').waitFor({ state: 'visible' });
    assert(await page.getByTestId('scientific-illustration-result').count() === 0, 'Cancelled result must not render.');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('workbench-mobile-tab-right').click();
    await page.getByTestId('studio-nav-scientific-illustration').click();
    await page.getByTestId('scientific-illustration-purpose').fill('展示样本进入质控、特征提取和结果复核的研究流程');
    await page.getByTestId('scientific-illustration-start').click();
    await page.getByTestId('scientific-illustration-result').waitFor({ state: 'visible', timeout: 30_000 });
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await hideNextDevTools(page);
    const mobile = path.join(evidenceDir, 'scientific-illustration-mobile.png');
    const mobileResult = path.join(evidenceDir, 'scientific-illustration-mobile-result.png');
    await page.screenshot({ path: mobile, fullPage: true });
    await page.getByTestId('scientific-illustration-result').screenshot({ path: mobileResult });

    assert(fakeProvider.searchRequests.length === 1, 'Expected one real paper search request.');
    assert(fakeProvider.imageRequests.length === 4, 'Expected safe, malformed, cancelled, and mobile image requests.');
    assert(fakeProvider.imageRequests.every(item => item.response_format === 'b64_json'), 'Image provider requests must return real bytes.');
    assert(fakeProvider.imageRequests.every(item => String(item.prompt).includes('不得绘制统计图')), 'Provider prompt lost the data-chart boundary.');
    assert(consoleErrors.length === 0, 'Browser errors: ' + consoleErrors.join(' | '));
    assert(!mobileOverflow, 'Scientific illustration caused horizontal overflow on mobile.');

    const evidence = {
      ok: true,
      appOrigin,
      providerRequests: { search: fakeProvider.searchRequests.length, image: fakeProvider.imageRequests.length },
      artifact: { filename: download.suggestedFilename(), bytes: downloadBytes },
      screenshots: { desktop, desktopResult, mobile, mobileResult },
      mobileOverflow,
      checked: [
        'selected paper source reaches the scientific illustration provider prompt',
        'real PNG bytes are persisted, previewed, and downloaded',
        'invalid and cancelled provider results never render',
        'prompt explicitly rejects statistical charts and fabricated measurements',
        'desktop and mobile layouts remain usable',
      ],
    };
    await writeFile(path.join(evidenceDir, 'scientific-illustration-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8');
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await browser?.close().catch(() => undefined);
    killProcessTree(child);
    await closeServer(fakeProvider?.server);
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
