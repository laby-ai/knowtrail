import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const workspace = process.cwd();
const startupTimeoutMs = Number(process.env.WORKBENCH_UI_SMOKE_TIMEOUT_MS || 45_000);
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
        if (!address || typeof address === 'string') {
          reject(new Error('Unable to allocate a local UI smoke app port.'));
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
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`UI smoke app exited before /api/health completed with code ${child.exitCode}.`);
    }

    try {
      const response = await fetch(`${origin}/api/health`, { cache: 'no-store' });
      const body = await response.json();
      if (response.ok && body.ok === true) return body;
      lastError = `HTTP ${response.status}: ${JSON.stringify(body)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for /api/health at ${origin}. Last error: ${lastError}`);
}

function killProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

async function resolveSmokeApp(tempDir) {
  if (process.env.APP_ORIGIN?.trim()) {
    return { appOrigin: process.env.APP_ORIGIN.trim(), child: undefined, managed: false, health: null };
  }

  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['scripts/dev.mjs'], {
    cwd: workspace,
    env: {
      ...process.env,
      PORT: String(port),
      DEPLOY_RUN_PORT: String(port),
      INTERNAL_APP_ORIGIN: '',
      SOURCE_STORE_PATH: path.join(tempDir, 'sources.json'),
      ZVEC_STORE_PATH: path.join(tempDir, 'zvec'),
      ALLOW_INSECURE_API_BASE: 'true',
      ALLOW_PRIVATE_API_BASE: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  const output = [];
  child.stdout.on('data', chunk => output.push(String(chunk)));
  child.stderr.on('data', chunk => output.push(String(chunk)));

  try {
    const health = await waitForHealth(origin, child);
    return { appOrigin: origin, child, managed: true, health, output };
  } catch (error) {
    const recentOutput = output.join('').slice(-4000);
    if (recentOutput) console.error(recentOutput);
    killProcessTree(child);
    throw error;
  }
}

async function expectVisible(locator, message) {
  await locator.waitFor({ state: 'visible', timeout: 15_000 }).catch(error => {
    throw new Error(`${message}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

async function expectDisabled(locator, message) {
  const disabled = await locator.isDisabled().catch(() => false);
  assert(disabled, message);
}

function assertServerManagedAIConfig(config, routeName) {
  const values = [config?.apiBase, config?.apiKey, config?.model, config?.visionModel, config?.embeddingModel];
  assert(values.every(value => !String(value || '').trim()), `${routeName} leaked provider configuration from the browser.`);
}

function assertSelectedPaperPayload(body, routeName) {
  const papers = Array.isArray(body?.papers) ? body.papers : [];
  assert(papers.length >= 1, `${routeName} did not receive selected papers.`);
  const paper = papers[0];
  assert(typeof paper.id === 'string' && paper.id.length > 0, `${routeName} did not receive selected paper id.`);
  assert(paper.fileName === 'studio-ui-smoke-source.txt', `${routeName} did not receive source fileName.`);
  assert(paper.fileType === 'txt', `${routeName} did not receive source fileType.`);
  assert(String(paper.rawContent || paper.content || '').includes('grounded context'), `${routeName} did not receive source content/rawContent.`);
}

async function interceptLongTask(page, pathname, routeName) {
  let hitCount = 0;
  await page.route(`**${pathname}`, async route => {
    hitCount += 1;
    const body = route.request().postDataJSON();
    assertServerManagedAIConfig(body?.aiConfig, routeName);
    assertSelectedPaperPayload(body, routeName);
    await new Promise(resolve => setTimeout(resolve, 10_000));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, cancelledSmokeResponse: true }),
    }).catch(() => undefined);
  });
  return () => hitCount;
}

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-studio-ui-smoke-'));
  const uploadPath = path.join(tempDir, 'studio-ui-smoke-source.txt');
  await writeFile(uploadPath, [
    'Lingbi Studio UI smoke source.',
    '第 1 页：右侧产品中心的 PPT 制作和研究脉络应该复用 grounded context。',
    '第 2 页：PPT 生成是长任务，必须显示等待进度、取消入口和可恢复文案。',
    '第 3 页：没有资料时按钮必须清晰禁用，不能让用户以为系统卡死。',
  ].join('\n'), 'utf8');

  let smokeApp;
  let browser;

  try {
    smokeApp = await resolveSmokeApp(tempDir);
    const { appOrigin } = smokeApp;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${appOrigin}/#workbench`, { waitUntil: 'networkidle' });
    await expectVisible(page.getByText('产物中心', { exact: true }), 'Product center did not render');

    await page.getByTestId('studio-nav-presentation').click();
    const noSourceButton = page.getByRole('button', { name: /先选择(资料|文献)/ }).first();
    await expectVisible(noSourceButton, 'No-source PPT guard did not render');
    await expectDisabled(noSourceButton, 'No-source PPT guard should be disabled');

    await page.getByRole('button', { name: '结构化 PPT' }).click();
    const noSourceAcademic = page.getByRole('button', { name: /先选择(资料|文献)/ }).first();
    await expectVisible(noSourceAcademic, 'No-source academic report guard did not render');
    await expectDisabled(noSourceAcademic, 'No-source academic report guard should be disabled');

    await page.getByTestId('studio-nav-knowledge').click();
    const noSourceKnowledgeMap = page.getByTestId('knowledge-map-generate');
    await expectVisible(noSourceKnowledgeMap, 'No-source knowledge-map guard did not render');
    await expectDisabled(noSourceKnowledgeMap, 'No-source knowledge-map guard should be disabled');

    await page.locator('input[type="file"]').setInputFiles(uploadPath);
    await expectVisible(
      page
        .getByTestId('library-selection-count')
        .filter({ hasText: /已选 1 个文献来源|已选 1 篇/ }),
      'Uploaded source was not auto-selected',
    );
    await page.getByTestId('studio-nav-presentation').click();
    await expectVisible(page.getByTestId('image-ppt-generate'), 'PPT generate button did not become available after source selection');

    const pptHits = await interceptLongTask(page, '/api/ai/ppt', '/api/ai/ppt');
    await page.getByTestId('image-ppt-generate').click();
    await expectVisible(page.getByText('正在生成演示文稿，可随时取消后调整资料、页数或风格重新开始。'), 'PPT long-task waiting copy did not render');
    await expectVisible(page.getByRole('button', { name: '取消生成' }).first(), 'PPT cancel button did not render');
    await page.getByRole('button', { name: '取消生成' }).first().click();
    await expectVisible(page.getByText('已取消生成，可以调整资料、页数或风格后重新开始。'), 'PPT cancel recovery copy did not render');
    assert(pptHits() >= 1, 'PPT generation request was not issued');

    await page.getByRole('button', { name: '结构化 PPT' }).click();
    await expectVisible(page.getByTestId('academic-ppt-outline-confirm'), 'Structured PPT outline confirmation did not become available after source selection');
    await page.getByTestId('academic-ppt-outline-confirm').click();
    await expectVisible(page.getByRole('button', { name: '生成结构化简报' }), 'Structured PPT generate button did not become available after outline confirmation');

    const pptV2Hits = await interceptLongTask(page, '/api/ai/ppt-v2', '/api/ai/ppt-v2');
    await page.getByRole('button', { name: '生成结构化简报' }).click();
    await expectVisible(page.getByText('正在准备结构化简报生成...'), 'Structured PPT staged progress did not render');
    await expectVisible(page.getByTestId('academic-ppt-job-progress'), 'Structured PPT progress panel did not render');
    await expectVisible(page.getByText('正在整理资料并构建演示文稿，生成期间可以随时取消。'), 'Structured PPT waiting copy did not render');
    await expectVisible(page.getByRole('button', { name: '取消生成' }).first(), 'Academic report cancel button did not render');
    await page.getByRole('button', { name: '取消生成' }).first().click();
    await expectVisible(page.getByText('已取消生成，可以调整设置后重新开始。'), 'Academic report cancel recovery copy did not render');
    assert(pptV2Hits() >= 1, 'Academic PPT generation request was not issued');

    await page.getByTestId('studio-nav-knowledge').click();
    const knowledgeMapGenerate = page.getByTestId('knowledge-map-generate');
    await expectVisible(knowledgeMapGenerate, 'Knowledge-map generate button did not render after source selection');
    if (await knowledgeMapGenerate.isDisabled()) throw new Error('Knowledge-map generate button stayed disabled after source selection');

    console.log(JSON.stringify({
      ok: true,
      appOrigin,
      managedApp: smokeApp.managed,
      checked: [
        'Workbench loads the product center',
        'PPT no-source guard is visible and disabled',
        'Academic report no-source guard is visible and disabled',
        'UI upload auto-selects source',
        'PPT generate button becomes available after source selection',
        'PPT request carries selected paper payload without browser provider credentials',
        'PPT long-task copy, cancel action, and recovery copy work',
        'Academic report request carries selected paper payload without browser provider credentials',
        'Academic report staged progress, cancel action, and recovery copy work',
        'Knowledge-map no-source guard is visible and disabled',
        'Knowledge-map generate button becomes available after source selection',
      ],
      requests: {
        ppt: pptHits(),
        pptV2: pptV2Hits(),
      },
    }, null, 2));
  } finally {
    await browser?.close().catch(() => undefined);
    killProcessTree(smokeApp?.child);
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
