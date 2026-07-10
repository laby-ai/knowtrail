import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const workspace = process.cwd();
const startupTimeoutMs = Number(process.env.CONFIGURED_WORKBENCH_FLOW_TIMEOUT_MS || 45_000);
const browserAITrap = {
  apiBase: 'https://ark.cn-beijing.volces.com/api/plan/v3',
  apiKey: 'ui-flow-key-not-secret',
  model: 'doubao-seed-2.0-pro',
  visionModel: 'ark-code-latest',
  embeddingModel: 'doubao-embedding-vision',
};

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
          reject(new Error('Unable to allocate a local configured workbench smoke app port.'));
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
      throw new Error(`Configured workbench smoke app exited before /api/health completed with code ${child.exitCode}.`);
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

function assertServerManagedAIConfig(config, routeName) {
  const values = [config?.apiBase, config?.apiKey, config?.model, config?.visionModel, config?.embeddingModel];
  assert(values.every(value => !String(value || '').trim()), `${routeName} leaked provider configuration from the browser.`);
}

function assertMultipartHasNoBrowserAIConfig(payload, routeName) {
  for (const value of Object.values(browserAITrap)) {
    assert(!payload.includes(value), `${routeName} leaked browser provider configuration.`);
  }
}

async function interceptUpload(page) {
  let hitCount = 0;
  await page.route('**/api/upload', async route => {
    hitCount += 1;
    const payload = route.request().postData() || '';
    assertMultipartHasNoBrowserAIConfig(payload, '/api/upload');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{
          id: 'configured-flow-source',
          title: 'Configured Flow Source',
          authors: ['Smoke Test'],
          year: 2026,
          keywords: ['configured-flow', 'grounded-context'],
          abstract: 'A source uploaded while provider configuration remains server managed.',
          content: 'KnowTrail keeps provider credentials out of browser upload, chat, and product-center requests.',
          rawContent: 'KnowTrail keeps provider credentials out of browser upload, chat, and product-center requests.',
          shortName: 'ConfiguredFlow',
          fileName: 'configured-flow.txt',
          fileType: 'txt',
          fileSize: 256,
          uploadTime: new Date().toISOString(),
          ingestionStatus: 'succeeded',
          ingestionStages: [
            { name: 'store', status: 'succeeded' },
            { name: 'extract', status: 'succeeded' },
            { name: 'chunk', status: 'succeeded' },
          ],
          ingestionChunkCount: 1,
          vectorIndex: { status: 'not_configured', count: 0 },
          mineruFigures: [],
        }],
      }),
    });
  });
  return () => hitCount;
}

async function interceptChat(page) {
  let hitCount = 0;
  await page.route('**/api/ai/chat', async route => {
    hitCount += 1;
    const body = route.request().postDataJSON();
    assertServerManagedAIConfig(body?.aiConfig, '/api/ai/chat');
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'data: {"citations":[{"sourceId":"configured-flow-source","chunkId":"configured-flow-source-c1","sourceTitle":"Configured Flow Source","snippet":"user supplied model config drives grounded chat","score":0.98}],"retrieval":{"mode":"persisted-keyword","persistedSourceCount":1,"vectorIndexedSourceCount":0,"degraded":true,"reason":"embedding index not configured in UI smoke"}}',
        '',
        'data: {"content":"模型配置由服务端托管，浏览器请求未携带 provider 凭据，并且答案带有可追溯引用 [1]。"}',
        '',
        'data: {"citationAudit":{"status":"pass","validMarkers":[1],"invalidMarkers":[],"missingMarkers":[]}}',
        '',
        'data: [DONE]',
        '',
      ].join('\n'),
    });
  });
  return () => hitCount;
}

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-configured-workbench-flow-'));
  const uploadPath = path.join(tempDir, 'configured-flow.txt');
  await writeFile(uploadPath, [
    'Configured Flow Source',
    '模型配置由服务端托管，上传、问答和产物中心请求不应携带 provider 凭据。',
    '这条 smoke 不连接真实付费模型，只验证浏览器用户路径和安全请求契约。',
  ].join('\n'), 'utf8');

  let smokeApp;
  let browser;

  try {
    smokeApp = await resolveSmokeApp(tempDir);
    const { appOrigin } = smokeApp;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

    await page.addInitScript(config => {
      window.localStorage.setItem('lingbi-ai-config', JSON.stringify(config));
    }, browserAITrap);

    const uploadHits = await interceptUpload(page);
    const chatHits = await interceptChat(page);

    await page.goto(`${appOrigin}/#workbench`, { waitUntil: 'networkidle' });
    await expectVisible(page.getByText('产物中心', { exact: true }), 'Workbench product center did not render.');

    const persistedConfig = await page.evaluate(() => {
      const raw = window.localStorage.getItem('lingbi-ai-config');
      return raw ? JSON.parse(raw) : null;
    });
    assert(persistedConfig === null, 'Workbench should clear legacy browser provider configuration.');

    await page.locator('input[type="file"]').setInputFiles(uploadPath);
    await expectVisible(page.getByTestId('library-selection-count').filter({ hasText: /已选 1 个文献来源|已选 1 篇/ }), 'Uploaded source was not auto-selected.');
    await expectVisible(page.getByText('Configured Flow Source'), 'Uploaded source title did not render in the library.');
    assert(uploadHits() === 1, 'Upload request was not issued exactly once.');

    await page.getByLabel('输入研究问题').fill('请说明服务端配置是否贯穿资料问答，并给出引用。');
    await page.getByRole('button', { name: '发送问题' }).click();
    await expectVisible(page.getByText('模型配置由服务端托管'), 'Server-managed chat response did not render.');
    await expectVisible(page.getByTestId('retrieval-badge').getByText('来源可用，索引完善中'), 'Configured chat retrieval status did not render.');
    await expectVisible(page.getByText('引用来源').first(), 'Configured chat citation UI did not render.');

    assert(chatHits() >= 1, 'Configured central chat request was not issued.');

    console.log(JSON.stringify({
      ok: true,
      appOrigin,
      managedApp: smokeApp.managed,
      checked: [
        'legacy browser provider configuration is cleared on workbench load',
        'upload request does not carry browser provider credentials',
        'uploaded source renders and is auto-selected',
        'central chat request does not carry browser provider credentials and renders citations',
        'central chat renders retrieval status instead of silently degrading',
      ],
      requests: {
        upload: uploadHits(),
        chat: chatHits(),
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
