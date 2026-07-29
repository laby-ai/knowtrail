import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const workspace = process.cwd();

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

async function waitForApp(origin, child, output) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`App exited with code ${child.exitCode}: ${output.join('').slice(-3000)}`);
    try {
      const response = await fetch(`${origin}/?view=workbench`, { cache: 'no-store' });
      if (response.ok) return;
    } catch {
      // Keep waiting for the managed local app.
    }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error(`Timed out waiting for the local page at ${origin}: ${output.join('').slice(-3000)}`);
}

function sse(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

const result = {
  title: '结构化阅读测试文献精读',
  mode: 'translation',
  sourceLanguage: 'English',
  targetLanguage: '简体中文',
  sections: [
    {
      label: '摘要',
      sourceText: 'Structured reading helps readers distinguish methods, findings, and limitations.',
      content: '结构化阅读有助于读者区分研究方法、主要发现和研究局限[1]。',
      evidenceMarkers: [1],
    },
    {
      label: '局限',
      sourceText: '',
      content: '当前测试只覆盖一个正文片段，完整译文仍需回到原文核验。',
      evidenceMarkers: [],
    },
  ],
  keyTerms: [{ source: 'structured reading', target: '结构化阅读' }],
  limitations: ['候选证据仍需回到原文核验。'],
};

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-paper-reading-'));
  const uploadPath = path.join(tempDir, 'paper-reading-source.txt');
  const uploadDir = path.join(workspace, 'public', 'uploads');
  const uploadsBefore = new Set(await readdir(uploadDir).catch(() => []));
  await writeFile(uploadPath, [
    '# Structured Reading Study',
    '## Abstract',
    'Structured reading helps readers distinguish methods, findings, and limitations.',
    '## Methods',
    'The study compares free reading with a section-guided workflow.',
    '## Results',
    'Readers using the section-guided workflow identified limitations more consistently.',
  ].join('\n\n'), 'utf8');

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
        BIND_HOST: '127.0.0.1',
        INTERNAL_APP_ORIGIN: '',
        SOURCE_STORE_PATH: path.join(tempDir, 'sources.json'),
        STUDIO_JOB_STORE_PATH: path.join(tempDir, 'studio-jobs.json'),
        ZVEC_STORE_PATH: path.join(tempDir, 'zvec'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    child.stdout.on('data', chunk => output.push(String(chunk)));
    child.stderr.on('data', chunk => output.push(String(chunk)));
    await waitForApp(appOrigin, child, output);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const consoleErrors = [];
    page.on('pageerror', error => consoleErrors.push(error.message));
    let readingRequests = 0;
    await page.route('**/api/ai/paper-reading', async route => {
      readingRequests += 1;
      const body = route.request().postDataJSON();
      assert(body.mode === 'translation', 'Paper reading UI sent the wrong mode.');
      assert(Array.isArray(body.papers) && body.papers.length === 1, 'Paper reading UI did not send exactly one selected source.');
      assert(!body.aiConfig, 'Paper reading UI must not send browser-side provider credentials.');
      const citation = {
        paperId: body.papers[0].id,
        paperShortName: body.papers[0].shortName,
        excerpt: 'Structured reading helps readers distinguish methods, findings, and limitations.',
        sourceId: body.papers[0].id,
        chunkId: `${body.papers[0].id}::chunk-1`,
        sourceTitle: body.papers[0].title,
        score: 1,
        chunkIndex: 0,
      };
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: [
          sse({ progress: { stage: 'evidence-ready', progress: 32, message: '已匹配 1 条正文证据。' }, citations: [citation], retrieval: { mode: 'test-fixture', persistedSourceCount: 1, vectorIndexedSourceCount: 1 } }),
          sse({ result, artifactMarkdown: '# 结构化阅读测试文献精读', artifactFileName: 'paper-reading-translation.md', readingStatus: { answerStatus: 'complete' } }),
          'data: [DONE]\n\n',
        ].join(''),
      });
    });

    await page.goto(`${appOrigin}/?view=workbench#workbench`, { waitUntil: 'networkidle' });
    assert(!page.url().includes('/account'), 'Supported local authentication redirected to account; browser acceptance requires a configured local session.');
    await page.getByTestId('studio-nav-paper-reading').click();
    const startButton = page.getByTestId('paper-reading-start');
    assert(await startButton.isDisabled(), 'Paper reading should be disabled before selecting a source.');

    await page.locator('input[type="file"]').setInputFiles(uploadPath);
    await page.getByTestId('library-selection-count').filter({ hasText: /已选 1 个文献来源|已选 1 篇/ }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('studio-nav-paper-reading').click();
    assert(!(await startButton.isDisabled()), 'Paper reading should become available after selecting one source.');
    await startButton.click();
    await page.getByTestId('paper-reading-result').waitFor({ state: 'visible', timeout: 30_000 }).catch(async error => {
      const bodyText = (await page.locator('body').innerText()).slice(-2500);
      throw new Error(`Paper reading result did not render: ${error.message}\n${bodyText}`);
    });
    await page.getByText('术语对照', { exact: true }).waitFor({ state: 'visible' });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('workbench-mobile-tab-right').click();
    await page.getByTestId('studio-nav-paper-reading').click();
    await page.getByTestId('paper-reading-start').click();
    await page.getByTestId('paper-reading-result').waitFor({ state: 'visible' });
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

    assert(readingRequests === 2, `Expected desktop and mobile paper reading requests, got ${readingRequests}.`);
    assert(!mobileOverflow, 'Paper reading caused horizontal overflow at 390px.');
    assert(consoleErrors.length === 0, `Browser reported page errors: ${consoleErrors.join(' | ')}`);
    console.log(JSON.stringify({
      ok: true,
      appOrigin,
      desktop: { width: 1440, resultVisible: true },
      mobile: { width: 390, resultVisible: true, horizontalOverflow: mobileOverflow },
      requests: readingRequests,
      checked: [
        'no-source disabled state',
        'selected-source request contract without browser model credentials',
        'structured result and terminology rendering',
        '390px layout without horizontal overflow',
      ],
    }, null, 2));
  } finally {
    if (browser) await browser.close();
    killProcessTree(child);
    const uploadsAfter = await readdir(uploadDir).catch(() => []);
    await Promise.all(uploadsAfter.filter(name => !uploadsBefore.has(name)).map(name => unlink(path.join(uploadDir, name)).catch(() => undefined)));
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
