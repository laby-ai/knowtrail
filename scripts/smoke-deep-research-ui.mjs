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

function openAiChunk(content) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

const completeReport = [
  '## 研究问题\n证据合成方法如何降低结论偏差[1]？\n\n',
  '## 研究边界\n本报告只分析当前文献本中的候选证据片段，不代表全网检索或全文核验[1]。\n\n',
  '## 关键词\n预注册、来源核验和纳入排除记录是当前证据中的关键概念[1]。\n\n',
  '## 证据来源\n当前来源描述了一套记录检索词、来源元数据、核验状态和纳入排除理由的方法[1]。\n\n',
  '## 主要结论\n透明记录能够减少选择性报告带来的偏差，并提高复核能力[1]。\n\n',
  '## 分论点\n预注册约束事后调整，来源元数据支持重复检索，核验状态区分候选与已确认材料[1]。\n\n',
  '## 争议或不足\n现有片段没有提供跨数据库召回率和统计检验结果，因此不能比较方法的量化优势[1]。\n\n',
  '## 可实操路线\n先固定研究问题和纳入标准，再记录检索式、逐条核验候选来源并保存排除理由[1]。\n\n',
  '## 还需要核验\n需要回到全文核对样本范围、评估指标和偏差测量方法[1]。\n',
];

async function startFakeResearchServices() {
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
          title: 'Evidence Synthesis Methods',
          link: `${origin}/paper/evidence-synthesis`,
          snippet: 'A reproducible method for evidence synthesis with explicit source verification.',
          date: '2025-05-18',
          authors: ['Ada Researcher', 'Lin Scholar'],
        }],
        total: 1,
      }));
      return;
    }
    if (request.method === 'GET' && request.url === '/paper/evidence-synthesis') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<html><head><title>Evidence Synthesis Methods</title></head><body><main><h1>Evidence Synthesis Methods</h1><p>This source describes a reproducible evidence synthesis method. Preregistration reduces selective reporting. The workflow records search terms, source metadata, verification status, limitations, and reasons to include or exclude each candidate paper.</p></main></body></html>');
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
      const chunks = prompt.includes('slow-cancel')
        ? ['## 研究问题\n已返回的部分研究内容 [1]\n\n', ...completeReport]
        : completeReport;
      for (const [index, chunk] of chunks.entries()) {
        if (closed) return;
        response.write(openAiChunk(chunk));
        await new Promise(resolve => setTimeout(resolve, prompt.includes('slow-cancel') && index === 0 ? 1800 : 25));
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
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-deep-research-'));
  const evidenceDir = path.join(workspace, 'output', 'playwright');
  await mkdir(evidenceDir, { recursive: true });
  const uploadDir = path.join(workspace, 'public', 'uploads');
  await mkdir(uploadDir, { recursive: true });
  const uploadsBefore = new Set(await readdir(uploadDir));
  let fakeServices;
  let child;
  let browser;

  try {
    fakeServices = await startFakeResearchServices();
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
        OPENAI_COMPAT_API_KEY: 'deep-research-smoke',
        OPENAI_COMPAT_MODEL: 'deep-research-smoke-model',
        ALLOW_INSECURE_API_BASE: 'true',
        ALLOW_PRIVATE_API_BASE: 'true',
        METASO_API_BASE: fakeServices.origin,
        METASO_API_KEY: 'deep-research-search-smoke',
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

    const noEvidenceResponse = await fetch(`${appOrigin}/api/ai/deep-research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: '没有可用证据时会怎样？',
        papers: [{ id: 'empty-paper', title: 'Metadata-only source', abstract: '', content: '', rawContent: '' }],
      }),
    });
    const noEvidenceBody = await noEvidenceResponse.json();
    assert(noEvidenceResponse.status === 422, `Expected no-evidence 422, got ${noEvidenceResponse.status}.`);
    assert(noEvidenceBody.errorType === 'deep_research_no_evidence', 'No-evidence response lost its stable error type.');
    assert(fakeServices.modelRequests.length === 0, 'No-evidence request should not invoke the model.');

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const consoleErrors = [];
    page.on('pageerror', error => consoleErrors.push(error.message));
    await page.goto(`${appOrigin}/#workbench`, { waitUntil: 'networkidle' });

    await page.getByTestId('discover-query').fill('evidence synthesis');
    await page.getByTestId('discover-search').click();
    await page.getByText('Evidence Synthesis Methods', { exact: true }).waitFor({ state: 'visible' });
    await page.getByTestId('discover-result-item').click();
    await page.getByTestId('discover-ingest').click();
    await page.getByTestId('paper-search-upload-summary').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('library-selection-count').filter({ hasText: /已选 1 个文献来源|已选 1 篇/ }).waitFor({ state: 'visible' });

    await page.getByTestId('studio-nav-deep-research').click();
    await page.getByTestId('deep-research-question').fill('证据合成方法如何降低结论偏差？');
    await page.getByTestId('deep-research-start').click();
    await page.getByTestId('deep-research-progress').waitFor({ state: 'visible' });
    await page.getByText('报告结构与引用编号检查通过；关键结论仍建议定位来源核验原文。').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('deep-research-result').getByText('主要结论', { exact: true }).waitFor({ state: 'visible' });
    await page.getByTestId('studio-evidence-citation-link').first().waitFor({ state: 'visible' });
    const desktopScreenshot = path.join(evidenceDir, 'deep-research-desktop.png');
    await page.screenshot({ path: desktopScreenshot, fullPage: true });

    await page.getByTestId('deep-research-question').fill('slow-cancel');
    await page.getByTestId('deep-research-start').click();
    await page.getByText('已返回的部分研究内容').waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByRole('button', { name: '停止研究' }).click();
    await page.getByText('已停止生成；已返回的正文和证据仍保留为未完成草稿。').waitFor({ state: 'visible' });
    await page.getByText('当前为未完成研究草稿，不能直接作为已核验报告。请补齐缺失章节或引用后再使用。').waitFor({ state: 'visible' });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('workbench-mobile-tab-right').click();
    await page.getByTestId('studio-nav-deep-research').click();
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const mobileScreenshot = path.join(evidenceDir, 'deep-research-mobile.png');
    await page.screenshot({ path: mobileScreenshot, fullPage: true });

    assert(fakeServices.searchRequests.length === 1, `Expected one paper search request, got ${fakeServices.searchRequests.length}.`);
    assert(fakeServices.modelRequests.length === 2, `Expected completed and cancelled model requests, got ${fakeServices.modelRequests.length}.`);
    assert(fakeServices.modelRequests.every(request => request.stream === true), 'Deep research did not request model streaming.');
    assert(fakeServices.modelRequests.every(request => JSON.stringify(request.messages).includes('只能基于已选来源')), 'Model prompt lost the selected-source boundary.');
    assert(consoleErrors.length === 0, `Browser errors: ${consoleErrors.join(' | ')}`);
    assert(!mobileOverflow, 'Deep research caused horizontal overflow on mobile.');

    const evidence = {
      ok: true,
      appOrigin,
      providerRequests: { search: fakeServices.searchRequests.length, model: fakeServices.modelRequests.length },
      noEvidence: { status: noEvidenceResponse.status, errorType: noEvidenceBody.errorType },
      screenshots: { desktop: desktopScreenshot, mobile: mobileScreenshot },
      mobileOverflow,
      checked: [
        'paper-search result is ingested and selected before deep research',
        'deep research streams a source-bounded report with complete section and citation audits',
        'evidence citations remain clickable back to the selected source',
        'no-evidence requests return 422 without invoking the model',
        'client cancellation preserves partial evidence and marks the draft incomplete',
      ],
    };
    await writeFile(path.join(evidenceDir, 'deep-research-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8');
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
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
