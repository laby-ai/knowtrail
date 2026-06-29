import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const workspace = process.cwd();
const startupTimeoutMs = Number(process.env.CONFIGURED_WORKBENCH_FLOW_TIMEOUT_MS || 45_000);
const configuredAI = {
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

function assertAIConfig(config, routeName) {
  assert(config?.apiBase === configuredAI.apiBase, `${routeName} did not receive the configured API Base.`);
  assert(config?.apiKey === configuredAI.apiKey, `${routeName} did not receive the configured API Key.`);
  assert(config?.model === configuredAI.model, `${routeName} did not receive the configured text model.`);
  assert(config?.visionModel === configuredAI.visionModel, `${routeName} did not receive the configured vision model.`);
  assert(config?.embeddingModel === configuredAI.embeddingModel, `${routeName} did not receive the configured embedding model.`);
}

function assertMultipartHasAIConfig(payload, routeName) {
  assert(payload?.includes('"aiConfig"') || payload?.includes('aiConfig'), `${routeName} did not include aiConfig in multipart payload.`);
  for (const value of Object.values(configuredAI)) {
    assert(payload.includes(value), `${routeName} multipart payload did not include ${value}.`);
  }
}

async function interceptUpload(page) {
  let hitCount = 0;
  await page.route('**/api/upload', async route => {
    hitCount += 1;
    const payload = route.request().postData() || '';
    assertMultipartHasAIConfig(payload, '/api/upload');
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
          abstract: 'A source uploaded while the user model configuration is active.',
          content: 'NotebookLM-like workbench should reuse user supplied API Base, API Key, text model, vision model, and embedding model across upload, chat, and Studio.',
          rawContent: 'NotebookLM-like workbench should reuse user supplied API Base, API Key, text model, vision model, and embedding model across upload, chat, and Studio.',
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
    assertAIConfig(body?.aiConfig, '/api/ai/chat');
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'data: {"citations":[{"sourceId":"configured-flow-source","chunkId":"configured-flow-source-c1","sourceTitle":"Configured Flow Source","snippet":"user supplied model config drives grounded chat","score":0.98}],"retrieval":{"mode":"persisted-keyword","persistedSourceCount":1,"vectorIndexedSourceCount":0,"degraded":true,"reason":"embedding index not configured in UI smoke"}}',
        '',
        'data: {"content":"用户填写的模型配置已经进入中央对话请求，并且答案带有可追溯引用 [1]。"}',
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

async function interceptStudioTool(page) {
  let hitCount = 0;
  await page.route('**/api/ai/studio-tool', async route => {
    hitCount += 1;
    const body = route.request().postDataJSON();
    assertAIConfig(body?.aiConfig, '/api/ai/studio-tool');
    assert(body?.toolId === 'interactive', 'Studio tool request did not target the interactive artifact.');
    await new Promise(resolve => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        artifact: {
          id: 'studio-tool-interactive-smoke',
          type: 'interactive',
          title: '互动页面',
          markdown: '## 用户配置如何进入 Studio？\n\n上传、中央对话和右侧互动页面都应复用同一份用户填写的 API Base、API Key 与模型名称。[1]',
          createdAt: new Date().toISOString(),
          generationPattern: '把资料转成可点击、可选择、可反馈的互动任务。',
          resultShape: ['互动目标', '页面状态', '用户动作', '反馈规则', '素材清单'],
        },
        citations: [{
          sourceId: 'configured-flow-source',
          chunkId: 'configured-flow-source-c1',
          sourceTitle: 'Configured Flow Source',
          snippet: 'user supplied model config drives grounded Studio output',
          score: 0.97,
        }],
        retrieval: {
          mode: 'persisted-keyword',
          persistedSourceCount: 1,
          vectorIndexedSourceCount: 0,
          degraded: true,
          reason: 'embedding index not configured in studio-tool UI smoke',
        },
        citationAudit: { status: 'pass', citationCount: 1, markerCount: 1, validMarkers: [1], invalidMarkers: [], missingMarkers: [] },
      }),
    });
  });
  return () => hitCount;
}

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-configured-workbench-flow-'));
  const uploadPath = path.join(tempDir, 'configured-flow.txt');
  await writeFile(uploadPath, [
    'Configured Flow Source',
    '用户填写 API Base、API Key、文本模型、视觉模型和向量模型后，上传、问答和 Studio 产物应该复用同一份配置。',
    '这条 smoke 不连接真实付费模型，只验证浏览器用户路径与请求契约。',
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
    }, configuredAI);

    const uploadHits = await interceptUpload(page);
    const chatHits = await interceptChat(page);
    const studioToolHits = await interceptStudioTool(page);

    await page.goto(`${appOrigin}/#workbench`, { waitUntil: 'networkidle' });
    await expectVisible(page.getByText('Studio', { exact: true }), 'Workbench Studio panel did not render.');

    const persistedConfig = await page.evaluate(() => {
      const raw = window.localStorage.getItem('lingbi-ai-config');
      return raw ? JSON.parse(raw) : null;
    });
    assertAIConfig(persistedConfig, 'localStorage');

    await page.locator('input[type="file"]').setInputFiles(uploadPath);
    await expectVisible(page.getByTestId('library-selection-count').getByText(/已选 1 (篇|个来源)/), 'Uploaded source was not auto-selected.');
    await expectVisible(page.getByText('Configured Flow Source'), 'Uploaded source title did not render in the library.');
    assert(uploadHits() === 1, 'Upload request was not issued exactly once.');

    await page.getByLabel(/输入(资料|学术)问题/).fill('请说明用户配置是否已经贯穿资料问答，并给出引用。');
    await page.getByRole('button', { name: '发送问题' }).click();
    await expectVisible(page.getByText('用户填写的模型配置已经进入中央对话请求'), 'Configured chat response did not render.');
    await expectVisible(page.getByTestId('retrieval-badge').getByText('来源可用，索引完善中'), 'Configured chat retrieval status did not render.');
    await expectVisible(page.getByText('引用来源').first(), 'Configured chat citation UI did not render.');

    await page.getByTestId('studio-nav-interactive').click();
    await expectVisible(page.getByTestId('studio-tool-run-interactive'), 'Interactive artifact generate button did not become available.');
    await page.getByTestId('studio-tool-run-interactive').click();
    await expectVisible(page.getByTestId('studio-tool-running-interactive'), 'Interactive artifact loading copy did not render.');
    await expectVisible(page.getByTestId('studio-tool-result-interactive').getByText('用户配置如何进入 Studio？'), 'Interactive Studio result did not render.');
    await expectVisible(page.getByTestId('studio-retrieval-badge').getByText('当前检索说明：embedding index not configured in studio-tool UI smoke'), 'Interactive Studio retrieval fallback reason did not render.');

    assert(chatHits() >= 1, 'Configured central chat request was not issued.');
    assert(studioToolHits() >= 1, 'Configured Studio tool request was not issued.');

    console.log(JSON.stringify({
      ok: true,
      appOrigin,
      managedApp: smokeApp.managed,
      checked: [
        'user model config is present in browser localStorage before workbench actions',
        'upload request carries the configured API Base, API Key, text model, vision model, and embedding model',
        'uploaded source renders and is auto-selected',
        'central chat request carries the same user model config and renders citations',
        'central chat renders retrieval status instead of silently degrading',
        'right-side Studio artifact request carries the same user model config',
        'interactive artifact loading copy and grounded result render',
        'right-side Studio artifact renders retrieval fallback reason',
      ],
      requests: {
        upload: uploadHits(),
        chat: chatHits(),
        studioTool: studioToolHits(),
      },
      models: {
        text: configuredAI.model,
        vision: configuredAI.visionModel,
        embedding: configuredAI.embeddingModel,
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
