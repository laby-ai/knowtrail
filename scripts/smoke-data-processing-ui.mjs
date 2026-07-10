import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
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

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-data-processing-'));
  const csvPath = path.join(tempDir, 'cohort.csv');
  await writeFile(csvPath, [
    'patient_id,site,age,response',
    'p1,A,20,yes',
    'p2,A,,no',
    'p3,B,42,yes',
    'p4,B,37,no',
  ].join('\n'), 'utf8');
  const evidenceDir = path.join(workspace, 'output', 'playwright');
  await mkdir(evidenceDir, { recursive: true });
  const uploadDir = path.join(workspace, 'public', 'uploads');
  await mkdir(uploadDir, { recursive: true });
  const uploadsBefore = new Set(await readdir(uploadDir));
  let child;
  let browser;

  try {
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
        ACCOUNT_CENTER_API_BASE: '',
        ACCOUNT_CENTER_TENANT_ID: '',
        ACCOUNT_CENTER_DEFAULT_MEMBER_ID: '',
        SOURCE_STORE_PATH: path.join(tempDir, 'sources.json'),
        STUDIO_JOB_STORE_PATH: path.join(tempDir, 'studio-jobs.json'),
        ZVEC_STORE_PATH: path.join(tempDir, 'zvec'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    child.stdout.on('data', chunk => output.push(String(chunk)));
    child.stderr.on('data', chunk => output.push(String(chunk)));
    await waitForHealth(appOrigin, child, output);

    const invalidResponse = await fetch(`${appOrigin}/api/data-processing/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'test',
        sampleUnit: 'row',
        taskFamily: 'prediction',
      }),
    });
    const invalidBody = await invalidResponse.json();
    assert(invalidResponse.status === 400, `Expected missing-source 400, got ${invalidResponse.status}.`);
    assert(invalidBody.code === 40002 && invalidBody.data === null, 'Missing-source error lost the {code,msg,data} contract.');

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const consoleErrors = [];
    let planRequests = 0;
    page.on('pageerror', error => consoleErrors.push(error.message));
    await page.route('**/api/data-processing/plan', async route => {
      planRequests += 1;
      const body = route.request().postDataJSON();
      if (body?.question === 'slow-cancel') {
        await new Promise(resolve => setTimeout(resolve, 4000));
      }
      await route.fallback().catch(() => undefined);
    });
    await page.goto(`${appOrigin}/#workbench`, { waitUntil: 'networkidle' });

    await page.getByTestId('studio-nav-data-processing').click();
    await page.getByTestId('data-processing-empty').waitFor({ state: 'visible' });
    await page.locator('input[type="file"]').setInputFiles(csvPath);
    await page.getByTestId('library-selection-count').filter({ hasText: /已选 1 个文献来源|已选 1 篇/ }).waitFor({ state: 'visible', timeout: 30_000 });

    await page.getByTestId('studio-nav-data-processing').click();
    await page.getByTestId('data-processing-preview').filter({ hasText: /4 行 × 4 列/ }).waitFor({ state: 'visible' });
    await page.getByTestId('data-processing-question').fill('能否用入组时信息预测治疗响应？');
    await page.getByTestId('data-processing-sample-unit').fill('单个患者');
    await page.getByTestId('data-processing-task').selectOption('prediction');
    await page.getByTestId('data-processing-target').selectOption('response');
    await page.getByTestId('data-processing-split').selectOption('site');
    await page.getByTestId('data-processing-start').click();
    await page.getByTestId('data-processing-result').waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByText(/age 缺失 1 行/).waitFor({ state: 'visible' });
    await page.getByText(/patient_id 看起来是标识列/).waitFor({ state: 'visible' });
    await page.getByText(/多数类和逻辑回归/).waitFor({ state: 'visible' });
    await page.getByText(/balanced accuracy、F1、PR-AUC、校准/).waitFor({ state: 'visible' });
    await page.getByText(/未执行模型训练、统计检验、图表生成或因果识别/).waitFor({ state: 'visible' });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('data-processing-download').click(),
    ]);
    const downloadPath = await download.path();
    assert(downloadPath, 'Data processing download did not produce a file.');
    const artifact = await readFile(downloadPath, 'utf8');
    assert(download.suggestedFilename() === 'cohort-data-plan.md', `Unexpected artifact filename: ${download.suggestedFilename()}`);
    assert(artifact.includes('## 数据合同') && artifact.includes('## Baseline 与评估'), 'Downloaded artifact lost required sections.');
    assert(artifact.includes('patient_id 看起来是标识列'), 'Downloaded artifact lost real field-quality evidence.');
    assert(!/模型已训练|显著优于|统计显著/.test(artifact), 'Downloaded artifact claimed unexecuted results.');

    const desktopScreenshot = path.join(evidenceDir, 'data-processing-desktop.png');
    await page.screenshot({ path: desktopScreenshot, fullPage: true });
    const desktopResultScreenshot = path.join(evidenceDir, 'data-processing-desktop-result.png');
    await page.getByTestId('data-processing-result').locator('section').first().screenshot({ path: desktopResultScreenshot });

    await page.getByTestId('data-processing-question').fill('slow-cancel');
    await page.getByTestId('data-processing-start').click();
    await page.getByTestId('data-processing-progress').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '取消' }).click();
    await page.getByText('数据处理已取消或超过等待时间，未生成不完整方案。').waitFor({ state: 'visible' });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('workbench-mobile-tab-right').click();
    await page.getByTestId('studio-nav-data-processing').click();
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const mobileScreenshot = path.join(evidenceDir, 'data-processing-mobile.png');
    await page.screenshot({ path: mobileScreenshot, fullPage: true });

    assert(planRequests === 2, `Expected successful and cancelled plan requests, got ${planRequests}.`);
    assert(consoleErrors.length === 0, `Browser errors: ${consoleErrors.join(' | ')}`);
    assert(!mobileOverflow, 'Data processing caused horizontal overflow on mobile.');

    const evidence = {
      ok: true,
      appOrigin,
      requests: { plan: planRequests },
      invalidContract: { status: invalidResponse.status, code: invalidBody.code },
      artifact: { filename: download.suggestedFilename(), bytes: Buffer.byteLength(artifact) },
      screenshots: { desktop: desktopScreenshot, desktopResult: desktopResultScreenshot, mobile: mobileScreenshot },
      mobileOverflow,
      checked: [
        'real CSV upload is parsed and auto-selected',
        'real rows, columns, missing values, identifier leakage, grouped split, baseline, and metrics render',
        'downloaded Markdown preserves the deterministic data contract and unsupported-result boundary',
        'missing-source errors follow {code,msg,data}',
        'client cancellation does not leave an incomplete plan',
      ],
    };
    await writeFile(path.join(evidenceDir, 'data-processing-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8');
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await browser?.close().catch(() => undefined);
    killProcessTree(child);
    const uploadsAfter = await readdir(uploadDir).catch(() => []);
    await Promise.all(uploadsAfter
      .filter(entry => !uploadsBefore.has(entry))
      .map(entry => unlink(path.join(uploadDir, entry)).catch(() => undefined)));
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
