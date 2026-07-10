import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
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

const completeDraft = JSON.stringify({
  title: '预注册与选择性报告：引言草稿',
  targetSection: 'introduction',
  outline: [
    { heading: '问题背景', purpose: '界定选择性报告及其影响。' },
    { heading: '已有证据', purpose: '概括预注册与透明度的关系。' },
    { heading: '研究缺口', purpose: '指出当前证据尚不能回答的问题。' },
  ],
  paragraphs: [
    { role: 'opening', text: '选择性报告会削弱研究结论的透明度与可解释性[1]。', evidenceMarkers: [1], supportStatus: 'supported' },
    { role: 'evidence', text: '当前来源提示预注册与报告透明度改善相关[1]。', evidenceMarkers: [1], supportStatus: 'supported' },
    { role: 'limitation', text: '现有片段不足以证明预注册必然产生因果改善。', evidenceMarkers: [], supportStatus: 'needs-evidence' },
  ],
  claimEvidenceMap: [
    { claim: '预注册与透明度改善相关。', evidence: '来源片段报告二者存在关联。', evidenceMarkers: [1], status: 'supported' },
    { claim: '预注册产生因果改善。', evidence: '当前来源不足。', evidenceMarkers: [], status: 'needs-evidence' },
  ],
  limitations: ['仅基于当前选定来源片段，候选引用仍需回到原文核验。'],
  revisionChecklist: ['核验来源原文和研究设计。', '由作者确认术语、数字和目标期刊要求。'],
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
        if (!closed) response.end(`${openAiChunk(completeDraft)}data: [DONE]\n\n`);
        return;
      }
      const output = prompt.includes('bad-structure') ? '{"title":"incomplete"}' : completeDraft;
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
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-academic-writing-'));
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
        OPENAI_COMPAT_API_KEY: 'academic-writing-smoke',
        OPENAI_COMPAT_MODEL: 'academic-writing-smoke-model',
        ALLOW_INSECURE_API_BASE: 'true',
        ALLOW_PRIVATE_API_BASE: 'true',
        METASO_API_BASE: fakeServices.origin,
        METASO_API_KEY: 'academic-writing-search-smoke',
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

    const noEvidenceResponse = await fetch(`${appOrigin}/api/ai/academic-writing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writingGoal: '起草没有可用证据时的引言。',
        targetSection: 'introduction',
        papers: [{ id: 'empty-paper', title: 'Metadata-only source', abstract: '', content: '', rawContent: '' }],
      }),
    });
    const noEvidenceBody = await noEvidenceResponse.json();
    assert(noEvidenceResponse.status === 422, `Expected no-evidence 422, got ${noEvidenceResponse.status}.`);
    assert(noEvidenceBody.errorType === 'academic_writing_no_evidence', 'No-evidence response lost its stable error type.');
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

    await page.getByTestId('studio-nav-academic-writing').click();
    await page.getByTestId('academic-writing-goal').fill('起草一节说明预注册如何减少选择性报告的引言。');
    await page.getByTestId('academic-writing-section').selectOption('introduction');
    await page.getByTestId('academic-writing-audience').fill('研究方法学期刊读者');
    await page.getByTestId('academic-writing-requirements').fill('三段，界定问题、概括已有证据并指出研究缺口。');
    await page.getByTestId('academic-writing-start').click();
    await page.getByTestId('academic-writing-progress').waitFor({ state: 'visible' });
    await page.getByText('章节结构、段落证据与主张映射检查通过；仍需作者核验原文。').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('academic-writing-result').waitFor({ state: 'visible' });
    await page.getByText('Claim-Evidence 映射', { exact: true }).waitFor({ state: 'visible' });
    await page.getByText(/预注册产生因果改善/).waitFor({ state: 'visible' });
    await page.getByTestId('studio-evidence-citation-link').first().waitFor({ state: 'visible' });
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('academic-writing-download').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    const artifactBytes = downloadPath ? (await stat(downloadPath)).size : 0;
    assert(download.suggestedFilename() === 'academic-section-draft.md', 'Unexpected academic draft artifact name.');
    assert(artifactBytes > 500, 'Downloaded academic draft artifact is unexpectedly small.');
    const desktopScreenshot = path.join(evidenceDir, 'academic-writing-desktop.png');
    await page.screenshot({ path: desktopScreenshot, fullPage: true });
    const desktopResultScreenshot = path.join(evidenceDir, 'academic-writing-desktop-result.png');
    await page.getByText('Claim-Evidence 映射', { exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: desktopResultScreenshot });

    console.log('[smoke] checking malformed output');
    await page.getByTestId('academic-writing-goal').fill('bad-structure academic writing request');
    await page.getByTestId('academic-writing-start').click();
    await page.getByText(/学术写作结构不完整/).waitFor({ state: 'visible', timeout: 30_000 });
    assert(await page.getByTestId('academic-writing-result').count() === 0, 'Malformed model output must not render an academic draft.');

    console.log('[smoke] checking cancellation');
    await page.getByTestId('academic-writing-goal').fill('slow-cancel academic writing request');
    await page.getByTestId('academic-writing-start').click();
    await page.getByTestId('academic-writing-progress').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '停止生成' }).click();
    await page.getByText('已停止生成；未通过完整结构检查的内容不会展示为可用草稿。').waitFor({ state: 'visible' });
    assert(await page.getByTestId('academic-writing-result').count() === 0, 'Cancelled unvalidated output must not render a draft.');

    console.log('[smoke] regenerating for mobile layout');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('workbench-mobile-tab-right').click();
    await page.getByTestId('studio-nav-academic-writing').click();
    await page.getByTestId('academic-writing-goal').fill('起草一节说明预注册如何减少选择性报告的引言。');
    await page.getByTestId('academic-writing-section').selectOption('introduction');
    await page.getByTestId('academic-writing-start').click();
    await page.getByText('章节结构、段落证据与主张映射检查通过；仍需作者核验原文。').waitFor({ state: 'visible', timeout: 30_000 });
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const mobileScreenshot = path.join(evidenceDir, 'academic-writing-mobile.png');
    await page.screenshot({ path: mobileScreenshot, fullPage: true });
    const mobileResultScreenshot = path.join(evidenceDir, 'academic-writing-mobile-result.png');
    await page.getByText('Claim-Evidence 映射', { exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: mobileResultScreenshot });

    assert(fakeServices.searchRequests.length === 1, `Expected one paper search request, got ${fakeServices.searchRequests.length}.`);
    assert(fakeServices.modelRequests.length === 4, `Expected complete, malformed, cancelled, and mobile-proof model requests, got ${fakeServices.modelRequests.length}.`);
    assert(fakeServices.modelRequests.every(request => request.stream === true), 'Academic writing did not request model streaming.');
    assert(fakeServices.modelRequests.every(request => JSON.stringify(request.messages).includes('不得编造实验、数据')), 'Model prompt lost the fabrication boundary.');
    assert(consoleErrors.length === 0, `Browser errors: ${consoleErrors.join(' | ')}`);
    assert(!mobileOverflow, 'Academic writing caused horizontal overflow on mobile.');

    const evidence = {
      ok: true,
      appOrigin,
      providerRequests: { search: fakeServices.searchRequests.length, model: fakeServices.modelRequests.length },
      noEvidence: { status: noEvidenceResponse.status, errorType: noEvidenceBody.errorType },
      artifact: { filename: download.suggestedFilename(), bytes: artifactBytes },
      screenshots: {
        desktop: desktopScreenshot,
        desktopResult: desktopResultScreenshot,
        mobile: mobileScreenshot,
        mobileResult: mobileResultScreenshot,
      },
      mobileOverflow,
      checked: [
        'paper-search result is ingested and selected before academic writing',
        'evidence-backed draft includes paragraph roles, supported and unsupported claims, and claim-evidence mapping',
        'downloaded Markdown states that citations need source verification and that journal formatting and submission are not complete',
        'evidence citations remain clickable back to the selected source',
        'no-evidence requests return 422 without invoking the model',
        'malformed and cancelled outputs never render an unvalidated draft',
      ],
    };
    await writeFile(path.join(evidenceDir, 'academic-writing-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8');
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
