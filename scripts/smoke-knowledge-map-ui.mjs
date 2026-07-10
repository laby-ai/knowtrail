import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const workspace = process.cwd();
const outDir = path.resolve('output', 'playwright');
const bannedUserFacingText = /Graphify|Hyper-Extract|OpenMAIC|MAIC|Karpathy|\bwiki\b|vis-network|模型推断/i;

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === 'string') return reject(new Error('Unable to allocate a smoke port.'));
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
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`Smoke app exited with ${child.exitCode}: ${output.join('').slice(-3000)}`);
    }
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

async function resolveApp(tempDir) {
  if (process.env.WORKBENCH_ORIGIN?.trim()) {
    return { origin: process.env.WORKBENCH_ORIGIN.trim(), child: undefined };
  }
  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const output = [];
  const child = spawn(process.execPath, ['scripts/dev.mjs'], {
    cwd: workspace,
    env: {
      ...process.env,
      PORT: String(port),
      DEPLOY_RUN_PORT: String(port),
      INTERNAL_APP_ORIGIN: '',
      ACCOUNT_CENTER_REQUIRE_AUTH: 'false',
      SOURCE_STORE_PATH: path.join(tempDir, 'sources.json'),
      ZVEC_STORE_PATH: path.join(tempDir, 'zvec'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  child.stdout.on('data', chunk => output.push(String(chunk)));
  child.stderr.on('data', chunk => output.push(String(chunk)));
  await waitForHealth(origin, child, output);
  return { origin, child };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-knowledge-map-'));
  const sourcePath = path.join(tempDir, 'knowledge-map-source.txt');
  const uploadDir = path.join(workspace, 'public', 'uploads');
  await mkdir(uploadDir, { recursive: true });
  const uploadsBefore = new Set(await readdir(uploadDir));
  await writeFile(sourcePath, [
    '研究问题：证据追踪如何提升跨文献综合的可复核性。',
    '方法：先记录检索范围，再对来源片段进行主题编码和证据分级。',
    '结果：研究脉络应区分核心概念、方法步骤、证据关系和局限。',
    '局限：来源不足时只能标记待核验，不能生成确定结论。',
  ].join('\n'), 'utf8');

  const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
  const desktopScreenshot = path.join(outDir, `knowledge-map-desktop-${runId}.png`);
  const mobileScreenshot = path.join(outDir, `knowledge-map-mobile-${runId}.png`);
  const evidencePath = path.join(outDir, `knowledge-map-ui-${runId}.json`);
  let app;
  let browser;

  try {
    app = await resolveApp(tempDir);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    const consoleErrors = [];
    const failedResponses = [];
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', error => consoleErrors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
    });

    await page.goto(`${app.origin}/#workbench`, { waitUntil: 'networkidle', timeout: 60_000 });
    if (await page.locator('[data-testid^="library-paper-"]').count() === 0) {
      await page.locator('input[type="file"]').setInputFiles(sourcePath);
      await page.waitForSelector('[data-testid="library-selection-count"]', { timeout: 30_000 });
    } else if (await page.locator('[data-testid="library-selection-count"]').count() === 0) {
      await page.locator('[data-testid^="library-paper-"]').first().click();
      await page.waitForSelector('[data-testid="library-selection-count"]', { timeout: 10_000 });
    }

    await page.getByTestId('studio-nav-knowledge').click();
    await page.getByTestId('knowledge-map-panel').waitFor({ state: 'visible' });
    await page.getByTestId('knowledge-map-generate').click();
    await page.getByTestId('knowledge-map-workspace').waitFor({ state: 'visible', timeout: 45_000 });
    await page.getByTestId('knowledge-map-focal-node').waitFor({ state: 'visible' });
    await page.getByTestId('knowledge-map-selected-node').waitFor({ state: 'visible' });

    const graphBox = await page.getByTestId('knowledge-map-graph').boundingBox();
    const detailText = await page.getByTestId('knowledge-map-detail').innerText();
    const focalCount = await page.locator('[data-testid="knowledge-map-focal-node"]').count();
    const nodeCount = await page.locator('[data-testid="knowledge-map-node"]').count() + focalCount;
    const edgeCount = await page.locator('[data-testid="knowledge-map-edge"]').count();
    const title = await page.getByTestId('knowledge-map-title').innerText();
    const selectedNode = await page.getByTestId('knowledge-map-selected-node').innerText();
    const bodyText = await page.locator('body').innerText();
    const userFacingLeak = bannedUserFacingText.test(bodyText);
    await page.screenshot({ path: desktopScreenshot, fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('workbench-mobile-tab-left').click();
    if (await page.getByTestId('library-selection-count').count() === 0) {
      await page.locator('[data-testid^="library-paper-"]').first().click();
      await page.getByTestId('library-selection-count').waitFor({ state: 'visible' });
    }
    await page.getByTestId('workbench-mobile-tab-right').click();
    await page.getByTestId('studio-nav-knowledge').click();
    await page.getByTestId('knowledge-map-panel').waitFor({ state: 'visible' });
    const mobileGenerate = page.getByTestId('knowledge-map-generate');
    if (await mobileGenerate.isDisabled()) {
      const selectionText = await page.getByTestId('library-selection-count').allInnerTexts().catch(() => []);
      throw new Error(`Mobile knowledge-map generation remained disabled; selection=${selectionText.join(' | ') || 'missing'}`);
    }
    await mobileGenerate.click();
    await page.getByTestId('workbench-mobile-tab-center').click();
    await page.getByTestId('knowledge-map-workspace').waitFor({ state: 'visible' }).catch(async error => {
      const body = (await page.locator('body').innerText()).slice(-2000);
      throw new Error(`Mobile knowledge-map workspace did not render: ${error instanceof Error ? error.message : String(error)}; body=${body}`);
    });
    await page.getByTestId('knowledge-map-workspace').scrollIntoViewIfNeeded();
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    await page.screenshot({ path: mobileScreenshot, fullPage: true });

    const evidence = {
      ok: Boolean(
        graphBox &&
        graphBox.width > 600 &&
        graphBox.height > 400 &&
        focalCount === 1 &&
        nodeCount >= 4 &&
        edgeCount >= 2 &&
        detailText.includes('引用状态') &&
        !userFacingLeak &&
        !mobileOverflow &&
        consoleErrors.length === 0
      ),
      url: `${app.origin}/#workbench`,
      title,
      selectedNode,
      graphBox,
      focalCount,
      nodeCount,
      edgeCount,
      detailHasCitationState: detailText.includes('引用状态'),
      userFacingLeak,
      mobileOverflow,
      consoleErrors: consoleErrors.slice(0, 8),
      failedResponses: failedResponses.slice(0, 12),
      screenshots: { desktop: desktopScreenshot, mobile: mobileScreenshot },
    };
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
    console.log(JSON.stringify({ ...evidence, evidencePath }, null, 2));
    if (!evidence.ok) process.exitCode = 1;
  } catch (error) {
    await writeFile(evidencePath, JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }, null, 2), 'utf8');
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    killProcessTree(app?.child);
    const uploadsAfter = await readdir(uploadDir).catch(() => []);
    await Promise.all(uploadsAfter.filter(name => !uploadsBefore.has(name)).map(name => unlink(path.join(uploadDir, name)).catch(() => undefined)));
    await rm(tempDir, { recursive: true, force: true });
  }
}

void main();
