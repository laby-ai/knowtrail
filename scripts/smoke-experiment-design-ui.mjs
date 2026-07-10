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

const completeProtocol = JSON.stringify({
  title: '预注册与选择性报告的多机构随机区组研究',
  studyMode: 'confirmatory',
  designType: '按机构分层的随机区组设计',
  designRationale: '机构政策可能影响报告实践，因此在机构内随机化并保留机构区组[1]。',
  researchQuestion: '预注册是否降低选择性报告？',
  hypothesis: '预注册组的选择性报告率低于未预注册对照组。',
  experimentalUnit: '独立研究项目',
  replicationLevel: '项目层级；同一项目内多个结局不是独立重复。',
  arms: [
    { name: '预注册', role: 'treatment', intervention: '采集前冻结主要结局和分析计划。' },
    { name: '未预注册对照', role: 'control', intervention: '沿用现有流程，不额外施加预注册要求。' },
  ],
  primaryOutcome: {
    name: '主要结局一致率',
    timing: '项目最终报告提交后评估',
    measurement: '比较采集前计划和最终报告中的主要结局。',
  },
  secondaryOutcomes: ['未报告结局数量', '分析方案偏离数量'],
  randomization: {
    method: '机构内置换区组随机化',
    unit: '独立研究项目',
    seedPlan: '实施前生成并归档整数 seed；分配表由独立人员保管。',
    allocationConcealment: '评估人员在项目结束前不可见分配序列。',
  },
  blockingAndBlinding: ['按机构区组', '结局编码人员对组别盲法'],
  confounders: [{ factor: '机构政策', control: '在机构内随机化并在分析中纳入机构区组。' }],
  sampleSizePlan: {
    effectBasis: '当前证据未提供可直接采用的效应量，需由既有研究、预实验或 SESOI 确定。',
    testFamily: '按主要结局分布选择两组比例或广义线性模型。',
    assumptions: 'alpha=0.05，目标 power=0.80；失访和机构内相关需另行膨胀。',
    nextAction: '确定效应依据和组内相关后运行采集前功效计算，归档输入、版本和输出。',
  },
  dataCollectionPlan: ['冻结主要结局定义', '记录机构与项目标识', '保留排除原因'],
  analysisPlan: ['以项目为独立单位', '主要分析匹配随机区组设计', '报告效应量与置信区间'],
  stoppingRules: ['固定 N；不根据未预注册的中期差异提前停止。'],
  exclusionRules: ['仅按采集前定义的资格标准排除项目。'],
  ethicsAndFeasibility: '执行机构需判断是否涉及伦理审查；本协议不代表审批已获得。',
  evidenceMarkers: [1],
  limitations: ['当前来源片段没有可直接采用的效应量，也未验证现场招募可行性。'],
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
        if (!closed) response.end(`${openAiChunk(completeProtocol)}data: [DONE]\n\n`);
        return;
      }
      const output = prompt.includes('bad-structure') ? '{"title":"incomplete"}' : completeProtocol;
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
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-experiment-design-'));
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
        OPENAI_COMPAT_API_KEY: 'experiment-design-smoke',
        OPENAI_COMPAT_MODEL: 'experiment-design-smoke-model',
        ALLOW_INSECURE_API_BASE: 'true',
        ALLOW_PRIVATE_API_BASE: 'true',
        METASO_API_BASE: fakeServices.origin,
        METASO_API_KEY: 'experiment-design-search-smoke',
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

    const noEvidenceResponse = await fetch(`${appOrigin}/api/ai/experiment-design`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: '没有可用证据时会怎样？',
        hypothesis: '处理组优于对照组。',
        experimentalUnit: '独立项目',
        arms: ['处理组', '对照组'],
        primaryOutcome: '主要结局一致率',
        alpha: 0.05,
        targetPower: 0.8,
        papers: [{ id: 'empty-paper', title: 'Metadata-only source', abstract: '', content: '', rawContent: '' }],
      }),
    });
    const noEvidenceBody = await noEvidenceResponse.json();
    assert(noEvidenceResponse.status === 422, `Expected no-evidence 422, got ${noEvidenceResponse.status}.`);
    assert(noEvidenceBody.errorType === 'experiment_design_no_evidence', 'No-evidence response lost its stable error type.');
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

    await page.getByTestId('studio-nav-experiment-design').click();
    await page.getByTestId('experiment-design-question').fill('预注册是否降低选择性报告？');
    await page.getByTestId('experiment-design-hypothesis').fill('预注册组的选择性报告率低于未预注册对照组。');
    await page.getByTestId('experiment-design-unit').fill('独立研究项目');
    await page.getByTestId('experiment-design-arms').fill('预注册, 未预注册对照');
    await page.getByTestId('experiment-design-outcome').fill('主要结局一致率，在项目最终报告提交后评估');
    await page.getByTestId('experiment-design-constraints').fill('项目来自不同机构，需要控制机构政策和评估者差异。');
    await page.getByTestId('experiment-design-start').click();
    await page.getByTestId('experiment-design-progress').waitFor({ state: 'visible' });
    await page.getByText('协议结构与证据编号检查通过；仍需执行功效计算、伦理审查和现场可行性复核。').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('experiment-design-result').waitFor({ state: 'visible' });
    await page.getByText('随机化、区组与盲法', { exact: true }).waitFor({ state: 'visible' });
    await page.getByText(/当前未执行样本量计算/).waitFor({ state: 'visible' });
    await page.getByTestId('studio-evidence-citation-link').first().waitFor({ state: 'visible' });
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('experiment-design-download').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    const artifactBytes = downloadPath ? (await stat(downloadPath)).size : 0;
    assert(download.suggestedFilename() === 'experiment-preregistration.md', 'Unexpected preregistration artifact name.');
    assert(artifactBytes > 500, 'Downloaded preregistration artifact is unexpectedly small.');
    const desktopScreenshot = path.join(evidenceDir, 'experiment-design-desktop.png');
    await page.screenshot({ path: desktopScreenshot, fullPage: true });
    const desktopResultScreenshot = path.join(evidenceDir, 'experiment-design-desktop-result.png');
    await page.getByText('样本量与功效边界', { exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: desktopResultScreenshot });

    console.log('[smoke] checking malformed output');
    await page.getByTestId('experiment-design-question').fill('bad-structure');
    await page.getByTestId('experiment-design-start').click();
    await page.getByText(/实验设计结构不完整/).waitFor({ state: 'visible', timeout: 30_000 });
    assert(await page.getByTestId('experiment-design-result').count() === 0, 'Malformed model output must not render an experiment protocol.');

    console.log('[smoke] checking cancellation');
    await page.getByTestId('experiment-design-question').fill('slow-cancel');
    await page.getByTestId('experiment-design-start').click();
    await page.getByTestId('experiment-design-progress').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '停止生成' }).click();
    await page.getByText('已停止生成；未通过完整结构检查的内容不会展示为可用协议。').waitFor({ state: 'visible' });
    assert(await page.getByTestId('experiment-design-result').count() === 0, 'Cancelled unvalidated output must not render a protocol.');

    console.log('[smoke] regenerating for mobile layout');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('workbench-mobile-tab-right').click();
    await page.getByTestId('studio-nav-experiment-design').click();
    await page.getByTestId('experiment-design-question').fill('预注册是否降低选择性报告？');
    await page.getByTestId('experiment-design-hypothesis').fill('预注册组的选择性报告率低于未预注册对照组。');
    await page.getByTestId('experiment-design-unit').fill('独立研究项目');
    await page.getByTestId('experiment-design-arms').fill('预注册, 未预注册对照');
    await page.getByTestId('experiment-design-outcome').fill('主要结局一致率，在项目最终报告提交后评估');
    await page.getByTestId('experiment-design-start').click();
    await page.getByText('协议结构与证据编号检查通过；仍需执行功效计算、伦理审查和现场可行性复核。').waitFor({ state: 'visible', timeout: 30_000 });
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const mobileScreenshot = path.join(evidenceDir, 'experiment-design-mobile.png');
    await page.screenshot({ path: mobileScreenshot, fullPage: true });
    const mobileResultScreenshot = path.join(evidenceDir, 'experiment-design-mobile-result.png');
    await page.getByText('样本量与功效边界', { exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: mobileResultScreenshot });

    assert(fakeServices.searchRequests.length === 1, `Expected one paper search request, got ${fakeServices.searchRequests.length}.`);
    assert(fakeServices.modelRequests.length === 4, `Expected complete, malformed, cancelled, and mobile-proof model requests, got ${fakeServices.modelRequests.length}.`);
    assert(fakeServices.modelRequests.every(request => request.stream === true), 'Experiment design did not request model streaming.');
    assert(fakeServices.modelRequests.every(request => JSON.stringify(request.messages).includes('不得根据通用经验拍脑袋给出样本量数字')), 'Model prompt lost the sample-size boundary.');
    assert(consoleErrors.length === 0, `Browser errors: ${consoleErrors.join(' | ')}`);
    assert(!mobileOverflow, 'Experiment design caused horizontal overflow on mobile.');

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
        'paper-search result is ingested and selected before experiment design',
        'evidence-backed protocol includes independent units, treatment/control, outcomes, randomization, bias controls, and preregistration boundaries',
        'downloaded Markdown explicitly states that sample size, ethics approval, experiment execution, and statistical analysis are not complete',
        'evidence citations remain clickable back to the selected source',
        'no-evidence requests return 422 without invoking the model',
        'malformed and cancelled outputs never render an unvalidated protocol',
      ],
    };
    await writeFile(path.join(evidenceDir, 'experiment-design-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8');
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
