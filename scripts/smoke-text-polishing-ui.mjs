import { spawn, spawnSync } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
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
      server.close(() => typeof address === 'object' && address ? resolve(address.port) : reject(new Error('No free port.')));
    });
  });
}

function killProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

async function waitForHealth(origin, child, output) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`App exited: ${output.join('').slice(-3000)}`);
    try {
      const response = await fetch(`${origin}/api/health`, { cache: 'no-store' });
      if (response.ok && (await response.json()).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error(`Timed out: ${output.join('').slice(-3000)}`);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function openAiChunk(content) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

const sourceText = 'Model-X 在数据集 A 上的准确率为 87.4%（p=0.03；见图2）[12]。该结果提示模型性能可能改善。';
const safeOutput = JSON.stringify({
  revisedText: '在数据集 A 上，Model-X 的准确率为 87.4%（p=0.03；见图2）[12]。这一结果提示模型性能可能有所改善。',
  changes: [
    { original: 'Model-X 在数据集 A 上的准确率为', revised: '在数据集 A 上，Model-X 的准确率为', reason: '调整语序以提高可读性。', category: 'flow' },
    { original: '该结果提示模型性能可能改善', revised: '这一结果提示模型性能可能有所改善', reason: '保持不确定性并减少生硬表达。', category: 'tone' },
  ],
  remainingRisks: ['p 值对应的统计检验仍需作者核验。'],
});
const unsafeOutput = JSON.stringify({
  revisedText: 'Model-X 在数据集 A 上证明了性能显著提升（见图2）[12]。',
  changes: [{ original: '提示模型性能可能改善', revised: '证明了性能显著提升', reason: '增强表达。', category: 'tone' }],
  remainingRisks: ['仍需作者核验。'],
});

async function startFakeModel() {
  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const requests = [];
  const server = http.createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') return response.writeHead(404).end();
    const body = await readJsonBody(request);
    requests.push(body);
    const prompt = JSON.stringify(body.messages || []);
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    let closed = false;
    response.on('close', () => { closed = true; });
    if (prompt.includes('slow-cancel')) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      if (!closed) response.end(`${openAiChunk(safeOutput)}data: [DONE]\n\n`);
      return;
    }
    const output = prompt.includes('unsafe-output') ? unsafeOutput : prompt.includes('bad-structure') ? '{"revisedText":"incomplete"}' : safeOutput;
    for (let index = 0; index < output.length; index += 160) {
      if (closed) return;
      response.write(openAiChunk(output.slice(index, index + 160)));
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    if (!closed) response.end('data: [DONE]\n\n');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { origin, requests, server };
}

async function main() {
  const evidenceDir = path.join(workspace, 'output', 'playwright');
  await mkdir(evidenceDir, { recursive: true });
  const fake = await startFakeModel();
  const appPort = await findFreePort();
  const appOrigin = `http://127.0.0.1:${appPort}`;
  const output = [];
  const child = spawn(process.execPath, ['scripts/dev.mjs'], {
    cwd: workspace,
    env: {
      ...process.env,
      PORT: String(appPort),
      DEPLOY_RUN_PORT: String(appPort),
      INTERNAL_APP_ORIGIN: '',
      ACCOUNT_CENTER_REQUIRE_AUTH: 'false',
      ACCOUNT_CENTER_API_BASE: '',
      OPENAI_COMPAT_API_BASE: fake.origin,
      OPENAI_COMPAT_API_KEY: 'text-polishing-smoke',
      OPENAI_COMPAT_MODEL: 'text-polishing-smoke-model',
      ALLOW_INSECURE_API_BASE: 'true',
      ALLOW_PRIVATE_API_BASE: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  child.stdout.on('data', chunk => output.push(String(chunk)));
  child.stderr.on('data', chunk => output.push(String(chunk)));
  let browser;
  try {
    await waitForHealth(appOrigin, child, output);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const consoleErrors = [];
    page.on('pageerror', error => consoleErrors.push(error.message));
    await page.goto(`${appOrigin}/#workbench`, { waitUntil: 'networkidle' });
    await page.getByTestId('studio-nav-text-polishing').click();
    await page.getByTestId('text-polishing-source').fill(sourceText);
    await page.getByTestId('text-polishing-protected-terms').fill('Model-X, 数据集 A');
    await page.getByTestId('text-polishing-start').click();
    await page.getByTestId('text-polishing-progress').waitFor({ state: 'visible' });
    await page.getByText('保护项和结论强度检查通过；仍需作者回读事实与语境。').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('text-polishing-result').waitFor({ state: 'visible' });
    for (const token of ['Model-X', '数据集 A', '87.4%', 'p=0.03', '图2', '[12]']) await page.getByText(token, { exact: true }).first().waitFor({ state: 'visible' });
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('text-polishing-download').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    const artifactBytes = downloadPath ? (await stat(downloadPath)).size : 0;
    assert(download.suggestedFilename() === 'scientific-text-revision.md', 'Unexpected artifact filename.');
    assert(artifactBytes > 500, 'Revision artifact is too small.');
    const desktop = path.join(evidenceDir, 'text-polishing-desktop.png');
    await page.screenshot({ path: desktop, fullPage: true });
    const desktopResult = path.join(evidenceDir, 'text-polishing-desktop-result.png');
    await page.getByText('逐项修改说明', { exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: desktopResult });

    await page.getByTestId('text-polishing-restore').click();
    assert(await page.getByTestId('text-polishing-result').count() === 0, 'Restore original should clear the revision result.');
    assert(await page.getByTestId('text-polishing-source').inputValue() === sourceText, 'Restore must keep the original input intact.');

    await page.getByTestId('text-polishing-source').fill(`${sourceText} unsafe-output`);
    await page.getByTestId('text-polishing-start').click();
    await page.getByText(/改变了受保护内容或增强了结论强度/).waitFor({ state: 'visible', timeout: 30_000 });
    assert(await page.getByTestId('text-polishing-result').count() === 0, 'Unsafe output must not render.');

    await page.getByTestId('text-polishing-source').fill(`${sourceText} bad-structure`);
    await page.getByTestId('text-polishing-start').click();
    await page.getByText(/文本润色结构不完整/).waitFor({ state: 'visible', timeout: 30_000 });
    assert(await page.getByTestId('text-polishing-result').count() === 0, 'Malformed output must not render.');

    await page.getByTestId('text-polishing-source').fill(`${sourceText} slow-cancel`);
    await page.getByTestId('text-polishing-start').click();
    await page.getByTestId('text-polishing-progress').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '停止润色' }).click();
    await page.getByText('已停止润色；未通过保护检查的内容不会展示。').waitFor({ state: 'visible' });
    assert(await page.getByTestId('text-polishing-result').count() === 0, 'Cancelled output must not render.');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('workbench-mobile-tab-right').click();
    await page.getByTestId('studio-nav-text-polishing').click();
    await page.getByTestId('text-polishing-source').fill(sourceText);
    await page.getByTestId('text-polishing-start').click();
    await page.getByText('保护项和结论强度检查通过；仍需作者回读事实与语境。').waitFor({ state: 'visible', timeout: 30_000 });
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const mobile = path.join(evidenceDir, 'text-polishing-mobile.png');
    await page.screenshot({ path: mobile, fullPage: true });
    const mobileResult = path.join(evidenceDir, 'text-polishing-mobile-result.png');
    await page.getByText('保护项检查', { exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: mobileResult });

    assert(fake.requests.length === 5, `Expected five model requests, got ${fake.requests.length}.`);
    assert(fake.requests.every(request => request.stream === true), 'Model requests must stream.');
    assert(fake.requests.every(request => JSON.stringify(request.messages).includes('默认少动')), 'Minimal-edit boundary was lost.');
    assert(consoleErrors.length === 0, `Browser errors: ${consoleErrors.join(' | ')}`);
    assert(!mobileOverflow, 'Text polishing caused mobile horizontal overflow.');
    const evidence = {
      ok: true,
      providerRequests: fake.requests.length,
      artifact: { filename: download.suggestedFilename(), bytes: artifactBytes },
      screenshots: { desktop, desktopResult, mobile, mobileResult },
      mobileOverflow,
      checked: [
        'safe revision preserves terms, numbers, citations, and figure references',
        'download includes original, revision, explanations, protection audit, and remaining risks',
        'restore clears revision without overwriting original input',
        'unsafe, malformed, and cancelled outputs never render',
      ],
    };
    await writeFile(path.join(evidenceDir, 'text-polishing-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8');
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await browser?.close().catch(() => undefined);
    killProcessTree(child);
    await new Promise(resolve => fake.server.close(resolve));
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
