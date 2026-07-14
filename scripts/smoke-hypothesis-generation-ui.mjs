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

const completeHypotheses = JSON.stringify({
  hypotheses: [
    {
      id: 'H1',
      title: '预注册约束选择性报告',
      statement: '在其他条件相近时，预注册可能降低选择性报告。',
      reasoningBasis: '来源描述了预注册与选择性报告减少之间的关联[1]。',
      competingExplanation: '研究团队培训和期刊政策也可能解释该关联[1]。',
      falsifiablePrediction: '若预注册没有独立作用，控制团队与期刊政策后两组报告偏差不会稳定分离。',
      validationPlan: '预先定义主要结局，比较预注册与未预注册项目并控制团队和期刊政策。',
      evidenceMarkers: [1],
      uncertainty: '当前片段未提供效应量，也未确认因果方向。',
    },
    {
      id: 'H2',
      title: '来源核验提升复核能力',
      statement: '显式记录来源核验状态可能提高证据合成的复核一致性。',
      reasoningBasis: '来源要求保存元数据、核验状态和纳入排除理由[1]。',
      competingExplanation: '更严格的团队流程本身可能提高一致性，而非核验字段单独起效。',
      falsifiablePrediction: '若核验状态无作用，加入该字段不会提高独立复核者之间的一致性。',
      validationPlan: '设置有无核验状态字段的盲法复核任务，比较一致性指标。',
      evidenceMarkers: [1],
      uncertainty: '尚需定义复核一致性的测量指标和样本范围。',
    },
    {
      id: 'H3',
      title: '排除理由减少事后调整',
      statement: '强制记录排除理由可能减少纳入标准的事后调整。',
      reasoningBasis: '来源把排除理由作为可复核工作流的一部分[1]。',
      competingExplanation: '研究者经验差异可能同时影响记录质量和标准稳定性。',
      falsifiablePrediction: '若记录排除理由无效，两种流程的标准变更频率应无稳定差异。',
      validationPlan: '比较两种流程中的标准变更次数，并记录变更发生的阶段。',
      evidenceMarkers: [1],
      uncertainty: '现有来源没有报告真实对照实验。',
    },
  ],
});

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
      if (prompt.includes('slow-cancel')) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        if (!closed) response.end(`${openAiChunk(completeHypotheses)}data: [DONE]\n\n`);
        return;
      }
      const output = prompt.includes('bad-structure') ? '{"hypotheses":[{"id":"H1"}]}' : completeHypotheses;
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
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-hypothesis-generation-'));
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
        OPENAI_COMPAT_API_KEY: 'hypothesis-smoke',
        OPENAI_COMPAT_MODEL: 'hypothesis-smoke-model',
        ALLOW_INSECURE_API_BASE: 'true',
        ALLOW_PRIVATE_API_BASE: 'true',
        METASO_API_BASE: fakeServices.origin,
        METASO_API_KEY: 'hypothesis-search-smoke',
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

    const noEvidenceResponse = await fetch(`${appOrigin}/api/ai/hypothesis-generation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: '没有可用证据时会怎样？',
        papers: [{ id: 'empty-paper', title: 'Metadata-only source', abstract: '', content: '', rawContent: '' }],
      }),
    });
    const noEvidenceBody = await noEvidenceResponse.json();
    assert(noEvidenceResponse.status === 422, `Expected no-evidence 422, got ${noEvidenceResponse.status}.`);
    assert(noEvidenceBody.errorType === 'hypothesis_generation_no_evidence', 'No-evidence response lost its stable error type.');
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

    await page.getByTestId('studio-nav-hypothesis-generation').click();
    await page.getByTestId('hypothesis-generation-question').fill('预注册为什么可能降低证据合成中的选择性报告？');
    await page.getByTestId('hypothesis-generation-start').click();
    await page.getByTestId('hypothesis-generation-progress').waitFor({ state: 'visible' });
    await page.getByText('假设结构与证据编号检查通过；仍需后续实验、数据和新颖性审查。').waitFor({ state: 'visible', timeout: 30_000 }).catch(async error => {
      const panelText = (await page.getByTestId('hypothesis-generation-panel').innerText()).slice(-2400);
      throw new Error(`Hypothesis completion state did not render: ${error instanceof Error ? error.message : String(error)}; panel=${panelText}; server=${output.join('').slice(-3000)}`);
    });
    assert(await page.getByTestId('hypothesis-card').count() === 3, 'Expected three rendered hypothesis cards.');
    await page.getByText('可证伪预测', { exact: true }).first().waitFor({ state: 'visible' });
    await page.getByTestId('studio-evidence-citation-link').first().waitFor({ state: 'visible' });
    const desktopScreenshot = path.join(evidenceDir, 'hypothesis-generation-desktop.png');
    await page.screenshot({ path: desktopScreenshot, fullPage: true });
    const desktopResultScreenshot = path.join(evidenceDir, 'hypothesis-generation-desktop-card.png');
    await page.getByTestId('hypothesis-card').first().screenshot({ path: desktopResultScreenshot });

    console.log('[smoke] checking malformed output');
    await page.getByTestId('hypothesis-generation-question').fill('bad-structure');
    await page.getByTestId('hypothesis-generation-start').click();
    await page.getByText(/假设结构不完整/).waitFor({ state: 'visible', timeout: 30_000 });
    assert(await page.getByTestId('hypothesis-card').count() === 0, 'Malformed model output must not render hypothesis cards.');

    console.log('[smoke] checking cancellation');
    await page.getByTestId('hypothesis-generation-question').fill('slow-cancel');
    await page.getByTestId('hypothesis-generation-start').click();
    await page.getByTestId('hypothesis-generation-progress').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '停止生成' }).click();
    await page.getByText('已停止生成；未通过完整结构检查的内容不会展示为可用假设。').waitFor({ state: 'visible' }).catch(async error => {
      const panelText = (await page.getByTestId('hypothesis-generation-panel').innerText()).slice(-2400);
      throw new Error(`Hypothesis cancellation state did not render: ${error instanceof Error ? error.message : String(error)}; panel=${panelText}; server=${output.join('').slice(-3000)}`);
    });
    assert(await page.getByTestId('hypothesis-card').count() === 0, 'Cancelled unvalidated output must not render hypothesis cards.');

    console.log('[smoke] regenerating for mobile layout');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('workbench-mobile-tab-right').click();
    await page.getByTestId('studio-nav-hypothesis-generation').click();
    await page.getByTestId('hypothesis-generation-question').fill('预注册为什么可能降低证据合成中的选择性报告？');
    await page.getByTestId('hypothesis-generation-start').click();
    await page.getByText('假设结构与证据编号检查通过；仍需后续实验、数据和新颖性审查。').waitFor({ state: 'visible', timeout: 30_000 });
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const mobileScreenshot = path.join(evidenceDir, 'hypothesis-generation-mobile.png');
    await page.screenshot({ path: mobileScreenshot, fullPage: true });
    const mobileResultScreenshot = path.join(evidenceDir, 'hypothesis-generation-mobile-card.png');
    await page.getByTestId('hypothesis-card').first().screenshot({ path: mobileResultScreenshot });

    assert(fakeServices.searchRequests.length === 1, `Expected one paper search request, got ${fakeServices.searchRequests.length}.`);
    assert(fakeServices.modelRequests.length === 4, `Expected complete, malformed, cancelled, and mobile-proof model requests, got ${fakeServices.modelRequests.length}.`);
    assert(fakeServices.modelRequests.every(request => request.stream === true), 'Hypothesis generation did not request model streaming.');
    assert(fakeServices.modelRequests.every(request => JSON.stringify(request.messages).includes('只能基于当前已选来源')), 'Model prompt lost the selected-source boundary.');
    assert(consoleErrors.length === 0, `Browser errors: ${consoleErrors.join(' | ')}`);
    assert(!mobileOverflow, 'Hypothesis generation caused horizontal overflow on mobile.');

    const evidence = {
      ok: true,
      appOrigin,
      providerRequests: { search: fakeServices.searchRequests.length, model: fakeServices.modelRequests.length },
      noEvidence: { status: noEvidenceResponse.status, errorType: noEvidenceBody.errorType },
      screenshots: {
        desktop: desktopScreenshot,
        desktopResult: desktopResultScreenshot,
        mobile: mobileScreenshot,
        mobileResult: mobileResultScreenshot,
      },
      mobileOverflow,
      checked: [
        'paper-search result is ingested and selected before hypothesis generation',
        'three evidence-backed hypothesis cards include competing explanations and falsifiable predictions',
        'evidence citations remain clickable back to the selected source',
        'no-evidence requests return 422 without invoking the model',
        'malformed and cancelled outputs never render unvalidated cards',
      ],
    };
    await writeFile(path.join(evidenceDir, 'hypothesis-generation-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8');
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
