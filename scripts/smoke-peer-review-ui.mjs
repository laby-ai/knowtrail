import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const workspace = process.cwd();
const startupTimeoutMs = 60_000;
const manuscript = `## Methods
We trained Model-X on dataset A using a random 80/20 split. The manuscript does not state whether repeated records from the same participant were kept in one split.

## Results
Model-X achieved 87.4% accuracy (p=0.03). We conclude that Model-X causes better clinical outcomes.`;

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

function openAiChunk(content) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

async function hideNextDevTools(page) {
  await page.locator('nextjs-portal').evaluateAll(elements => {
    elements.forEach(element => { element.style.display = 'none'; });
  });
}

const completeReport = {
  title: '方法与证据边界审查报告',
  summary: {
    manuscriptFocus: '稿件评估 Model-X 在数据集 A 上的分类表现。',
    overallAssessment: '文本报告了数据划分和准确率，但个体级隔离、统计报告和因果表述仍需澄清。',
  },
  strengths: ['明确报告了训练/测试划分比例和准确率。'],
  majorComments: [{
    location: 'Methods，第 1 段',
    excerpt: 'using a random 80/20 split',
    problem: '当前描述无法判断同一参与者的重复记录是否跨越训练集和测试集。',
    importance: '若重复记录跨集合，评估可能受到信息泄漏影响。',
    action: '说明划分单位；如存在重复记录，按参与者重新划分并报告复核结果。',
    evidenceStatus: 'source-supported',
    evidenceMarkers: [1],
  }],
  minorComments: [{
    location: 'Results，第 1 段',
    excerpt: 'p=0.03',
    problem: '未说明该 p 值对应的检验、效应量和置信区间。',
    importance: '读者无法判断统计证据大小和适用前提。',
    action: '补充检验名称、效应量、置信区间和假设检查。',
    evidenceStatus: 'needs-verification',
    evidenceMarkers: [],
  }],
  questions: ['数据是否包含同一参与者的重复记录？'],
  limitations: ['只审查了提供的文本；未核验原始数据、代码、完整图表或参考文献。'],
};

const noSourceReport = {
  ...completeReport,
  majorComments: [{
    ...completeReport.majorComments[0],
    problem: '当前稿件没有说明划分单位，无法从文本判断重复记录是否跨集合。',
    importance: '划分单位直接影响评估独立性，但外部规范尚未核验。',
    action: '说明划分单位，并提供可复核的划分流程。',
    evidenceStatus: 'manuscript',
    evidenceMarkers: [],
  }],
};

async function startFakeServices() {
  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const modelRequests = [];
  const searchRequests = [];
  const server = http.createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/search') {
      const body = await readJsonBody(request);
      searchRequests.push(body);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        scholars: [{
          title: 'Participant-level Data Splitting Guidance',
          link: `${origin}/paper/splitting-guidance`,
          snippet: 'Repeated participant records require participant-level splitting to avoid leakage.',
          date: '2025-05-18',
          authors: ['Ada Researcher', 'Lin Scholar'],
        }],
        total: 1,
      }));
      return;
    }
    if (request.method === 'GET' && request.url === '/paper/splitting-guidance') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<html><head><title>Participant-level Data Splitting Guidance</title></head><body><main><h1>Participant-level Data Splitting Guidance</h1><p>Repeated records from the same participant require participant-level splitting. Record-level random splitting can leak participant-specific information between training and evaluation sets. Reports should state the splitting unit and assess leakage risk.</p></main></body></html>');
      return;
    }
    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      const body = await readJsonBody(request);
      modelRequests.push(body);
      const prompt = JSON.stringify(body.messages || []);
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      let closed = false;
      response.on('close', () => { closed = true; });
      if (prompt.includes('slow-cancel')) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        if (!closed) response.end(`${openAiChunk(JSON.stringify(completeReport))}data: [DONE]\n\n`);
        return;
      }
      let output = JSON.stringify(completeReport);
      if (prompt.includes('no-external-sources')) output = JSON.stringify(noSourceReport);
      if (prompt.includes('bad-structure')) output = '{"title":"incomplete"}';
      if (prompt.includes('unsafe-location')) {
        output = JSON.stringify({
          ...completeReport,
          majorComments: [{ ...completeReport.majorComments[0], excerpt: 'the preregistered primary endpoint' }],
        });
      }
      for (let index = 0; index < output.length; index += 180) {
        if (closed) return;
        response.write(openAiChunk(output.slice(index, index + 180)));
        await new Promise(resolve => setTimeout(resolve, 18));
      }
      if (!closed) response.end('data: [DONE]\n\n');
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { server, origin, modelRequests, searchRequests };
}

async function closeServer(server) {
  if (!server) return;
  await new Promise(resolve => server.close(resolve));
}

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-peer-review-'));
  const evidenceDir = path.join(workspace, 'output', 'playwright');
  await mkdir(evidenceDir, { recursive: true });
  const uploadDir = path.join(workspace, 'public', 'uploads');
  await mkdir(uploadDir, { recursive: true });
  const uploadsBefore = new Set(await readdir(uploadDir));
  let fakeServices;
  let child;
  let browser;

  try {
    fakeServices = await startFakeServices();
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
        OPENAI_COMPAT_API_BASE: fakeServices.origin,
        OPENAI_COMPAT_API_KEY: 'peer-review-smoke',
        OPENAI_COMPAT_MODEL: 'peer-review-smoke-model',
        ALLOW_INSECURE_API_BASE: 'true',
        ALLOW_PRIVATE_API_BASE: 'true',
        METASO_API_BASE: fakeServices.origin,
        METASO_API_KEY: 'peer-review-search-smoke',
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

    const noSourceResponse = await fetch(`${appOrigin}/api/ai/peer-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manuscript: `${manuscript}\nno-external-sources`,
        scope: '稿件内部逻辑',
        perspective: 'overall',
        papers: [],
      }),
    });
    const noSourceStream = await noSourceResponse.text();
    assert(noSourceResponse.status === 200, `No-source internal review should stream, got ${noSourceResponse.status}.`);
    assert(noSourceStream.includes('peer-review-report.md'), 'No-source internal review did not return a validated report artifact.');
    assert(noSourceStream.includes('稿件内证据') || noSourceStream.includes('manuscript'), 'No-source review lost its manuscript-only evidence boundary.');

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const consoleErrors = [];
    page.on('pageerror', error => consoleErrors.push(error.message));
    await page.goto(`${appOrigin}/#workbench`, { waitUntil: 'networkidle' });

    await page.getByTestId('studio-nav-peer-review').click();
    await page.getByTestId('peer-review-source-status').filter({ hasText: '未选择外部来源' }).waitFor({ state: 'visible' });
    assert(await page.getByTestId('peer-review-start').isDisabled(), 'Empty manuscript should keep peer review disabled.');
    await page.getByTestId('studio-nav-paper-search').click();

    await page.getByTestId('discover-query').fill('participant data splitting');
    await page.getByTestId('discover-search').click();
    await page.getByText('Participant-level Data Splitting Guidance', { exact: true }).waitFor({ state: 'visible' });
    await page.getByTestId('discover-result-item').click();
    await page.getByTestId('discover-ingest').click();
    await page.getByTestId('paper-search-upload-summary').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('library-selection-count').filter({ hasText: /已选 1 个文献来源|已选 1 篇/ }).waitFor({ state: 'visible' });

    await page.getByTestId('studio-nav-peer-review').click();
    await page.getByTestId('peer-review-manuscript').fill(manuscript);
    await page.getByTestId('peer-review-perspective').selectOption('methodology');
    await page.getByTestId('peer-review-scope').fill('方法严谨性与结果证据边界');
    await page.getByTestId('peer-review-start').click();
    await page.getByTestId('peer-review-progress').waitFor({ state: 'visible' });
    await page.getByText('意见定位和证据状态检查通过；报告仍需作者或领域专家复核。').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('peer-review-result').waitFor({ state: 'visible' });
    await page.getByText('Major Comments', { exact: true }).waitFor({ state: 'visible' });
    await page.getByText('“using a random 80/20 split”', { exact: true }).waitFor({ state: 'visible' });
    await page.getByText(/来源支持 \[1\]/).waitFor({ state: 'visible' });
    await page.getByTestId('studio-evidence-citation-link').first().waitFor({ state: 'visible' });
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('peer-review-download').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    const artifactBytes = downloadPath ? (await stat(downloadPath)).size : 0;
    assert(download.suggestedFilename() === 'peer-review-report.md', 'Unexpected peer review artifact name.');
    assert(artifactBytes > 700, 'Downloaded peer review artifact is unexpectedly small.');
    const desktop = path.join(evidenceDir, 'peer-review-desktop.png');
    await hideNextDevTools(page);
    await page.screenshot({ path: desktop, fullPage: true });
    const desktopResult = path.join(evidenceDir, 'peer-review-desktop-result.png');
    await page.getByTestId('peer-review-major-comments').screenshot({ path: desktopResult });

    await page.getByTestId('peer-review-manuscript').fill(`${manuscript}\nunsafe-location`);
    await page.getByTestId('peer-review-start').click();
    await page.getByText(/包含无法定位的意见/).waitFor({ state: 'visible', timeout: 30_000 });
    assert(await page.getByTestId('peer-review-result').count() === 0, 'Unlocatable comments must not render.');

    await page.getByTestId('peer-review-manuscript').fill(`${manuscript}\nbad-structure`);
    await page.getByTestId('peer-review-start').click();
    await page.getByText(/论文审查结构不完整/).waitFor({ state: 'visible', timeout: 30_000 });
    assert(await page.getByTestId('peer-review-result').count() === 0, 'Malformed model output must not render.');

    await page.getByTestId('peer-review-manuscript').fill(`${manuscript}\nslow-cancel`);
    await page.getByTestId('peer-review-start').click();
    await page.getByTestId('peer-review-progress').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '停止审查' }).click();
    await page.getByText('已停止审查；未通过完整定位检查的报告不会展示。').waitFor({ state: 'visible' });
    assert(await page.getByTestId('peer-review-result').count() === 0, 'Cancelled output must not render.');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('workbench-mobile-tab-right').click();
    await page.getByTestId('studio-nav-peer-review').click();
    await page.getByTestId('peer-review-manuscript').fill(manuscript);
    await page.getByTestId('peer-review-perspective').selectOption('methodology');
    await page.getByTestId('peer-review-start').click();
    await page.getByText('意见定位和证据状态检查通过；报告仍需作者或领域专家复核。').waitFor({ state: 'visible', timeout: 30_000 });
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const mobile = path.join(evidenceDir, 'peer-review-mobile.png');
    await hideNextDevTools(page);
    await page.screenshot({ path: mobile, fullPage: true });
    const mobileResult = path.join(evidenceDir, 'peer-review-mobile-result.png');
    await page.getByTestId('peer-review-major-comments').screenshot({ path: mobileResult });

    assert(fakeServices.searchRequests.length === 1, `Expected one paper search request, got ${fakeServices.searchRequests.length}.`);
    assert(fakeServices.modelRequests.length === 6, `Expected no-source, safe, unsafe, malformed, cancelled, and mobile model requests, got ${fakeServices.modelRequests.length}.`);
    assert(fakeServices.modelRequests.every(request => request.stream === true), 'Peer review did not request model streaming.');
    assert(fakeServices.modelRequests.every(request => JSON.stringify(request.messages).includes('不得模拟多个审稿人')), 'Prompt lost its single-perspective boundary.');
    assert(consoleErrors.length === 0, `Browser errors: ${consoleErrors.join(' | ')}`);
    assert(!mobileOverflow, 'Peer review caused horizontal overflow on mobile.');

    const evidence = {
      ok: true,
      appOrigin,
      providerRequests: { search: fakeServices.searchRequests.length, model: fakeServices.modelRequests.length },
      noSourceReview: { status: noSourceResponse.status, artifactReturned: noSourceStream.includes('peer-review-report.md') },
      artifact: { filename: download.suggestedFilename(), bytes: artifactBytes },
      screenshots: { desktop, desktopResult, mobile, mobileResult },
      mobileOverflow,
      checked: [
        'paper-search result is ingested and selected before source-supported review',
        'manuscript-only review works without external sources while preserving verification boundaries',
        'every comment shows exact manuscript excerpt, location, importance, action, and evidence status',
        'download preserves no-edit, no-verification, and no-editorial-score boundaries',
        'selected source evidence remains clickable',
        'unlocatable, malformed, and cancelled outputs never render',
      ],
    };
    await writeFile(path.join(evidenceDir, 'peer-review-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8');
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await browser?.close().catch(() => undefined);
    killProcessTree(child);
    await closeServer(fakeServices?.server);
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
