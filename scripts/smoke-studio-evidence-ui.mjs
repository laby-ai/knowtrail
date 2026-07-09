import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const workspace = process.cwd();
const startupTimeoutMs = Number(process.env.STUDIO_EVIDENCE_UI_TIMEOUT_MS || 45_000);

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
          reject(new Error('Unable to allocate a local Studio evidence smoke app port.'));
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
      throw new Error(`Studio evidence smoke app exited before /api/health completed with code ${child.exitCode}.`);
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
    return { appOrigin: process.env.APP_ORIGIN.trim(), child: undefined, managed: false };
  }
  const port = await findFreePort();
  const appOrigin = `http://127.0.0.1:${port}`;
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
    await waitForHealth(appOrigin, child);
    return { appOrigin, child, managed: true, output };
  } catch (error) {
    const recentOutput = output.join('').slice(-4000);
    if (recentOutput) console.error(recentOutput);
    killProcessTree(child);
    throw error;
  }
}

async function expectVisible(locator, message, timeout = 15_000) {
  await locator.waitFor({ state: 'visible', timeout }).catch(error => {
    throw new Error(`${message}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

function sse(lines) {
  return lines.map(line => `data: ${line}\n\n`).join('');
}

async function interceptUpload(page) {
  let hitCount = 0;
  await page.route('**/api/upload', async route => {
    hitCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{
          id: 'studio-evidence-source',
          title: 'Studio Evidence Source',
          authors: ['Smoke Test'],
          year: 2026,
          keywords: ['citation', 'grounded-context'],
          abstract: 'Source for validating visible citations in Studio outputs.',
          content: '右侧知识卡片和中心综述报告必须展示 grounded retrieval、引用来源和引用编号审计。',
          rawContent: '第 4 页：Studio outputs should show citations, retrieval mode, and citation audit status.',
          shortName: 'EvidenceUI',
          fileName: 'studio-evidence.txt',
          fileType: 'txt',
          fileSize: 240,
          uploadTime: new Date().toISOString(),
          ingestionStatus: 'succeeded',
          ingestionStages: [{ name: 'chunk', status: 'succeeded' }],
          ingestionChunkCount: 1,
          vectorIndex: { status: 'not_configured', count: 0 },
          mineruFigures: [],
        }, {
          id: 'studio-contrast-source',
          title: 'Studio Contrast Source',
          authors: ['Smoke Test'],
          year: 2025,
          keywords: ['comparison', 'evidence-matrix'],
          abstract: 'Second source for validating selected-source matrix comparison without AI conclusions.',
          content: '文献矩阵只应展示已选来源的字段和证据状态，不直接生成跨文献结论。',
          rawContent: '第 2 页：Selected source matrix should compare fields, keywords, and evidence readiness.',
          shortName: 'ContrastUI',
          fileName: 'studio-contrast.txt',
          fileType: 'txt',
          fileSize: 260,
          uploadTime: new Date().toISOString(),
          ingestionStatus: 'succeeded',
          ingestionStages: [{ name: 'chunk', status: 'succeeded' }],
          ingestionChunkCount: 1,
          vectorIndex: { status: 'not_configured', count: 0 },
          mineruFigures: [],
        }],
      }),
    });
  });
  return () => hitCount;
}

async function interceptAccountStatus(page) {
  await page.route('**/api/account/status', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        configured: false,
        publicUrl: null,
        apiBaseConfigured: false,
        tenantIdConfigured: false,
        memberBindingConfigured: false,
        appSignatureConfigured: false,
        authRequired: false,
        billingReservationReady: false,
        billingMode: 'not_configured',
      }),
    });
  });
}

async function interceptIngestionSources(page) {
  let hitCount = 0;
  await page.route('**/api/ingestion/sources**', async route => {
    hitCount += 1;
    const url = new URL(route.request().url());
    const id = url.searchParams.get('id');
    const source = {
      id: 'studio-evidence-source',
      title: 'Studio Evidence Source',
      shortName: 'EvidenceUI',
      fileName: 'studio-evidence.txt',
      fileType: 'txt',
      fileSize: 240,
      status: 'succeeded',
      stages: [{ name: 'chunk', status: 'succeeded' }],
      chunkCount: 1,
      tokenEstimate: 18,
      vectorIndex: { status: 'not_configured', count: 0 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      chunks: [{
        id: 'studio-evidence-source-c1',
        sourceId: 'studio-evidence-source',
        sourceIndex: 0,
        chunkIndex: 0,
        page: 4,
        paperShortName: 'EvidenceUI',
        sourceTitle: 'Studio Evidence Source',
        text: '第 4 页：Studio outputs should show citations, retrieval mode, and citation audit status.',
        tokenEstimate: 18,
      }],
    };
    const contrastSource = {
      id: 'studio-contrast-source',
      title: 'Studio Contrast Source',
      shortName: 'ContrastUI',
      fileName: 'studio-contrast.txt',
      fileType: 'txt',
      fileSize: 260,
      status: 'succeeded',
      stages: [{ name: 'chunk', status: 'succeeded' }],
      chunkCount: 1,
      tokenEstimate: 16,
      vectorIndex: { status: 'not_configured', count: 0 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      chunks: [{
        id: 'studio-contrast-source-c1',
        sourceId: 'studio-contrast-source',
        sourceIndex: 1,
        chunkIndex: 0,
        page: 2,
        paperShortName: 'ContrastUI',
        sourceTitle: 'Studio Contrast Source',
        text: '第 2 页：Selected source matrix should compare fields, keywords, and evidence readiness.',
        tokenEstimate: 16,
      }],
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(id === 'studio-evidence-source'
        ? { source }
        : id === 'studio-contrast-source'
          ? { source: contrastSource }
          : { sources: [] }),
    });
  });
  return () => hitCount;
}

async function interceptReport(page) {
  let hitCount = 0;
  await page.route('**/api/ai/report', async route => {
    hitCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sse([
        '{"citations":[{"paperId":"studio-evidence-source","paperShortName":"EvidenceUI","sourceId":"studio-evidence-source","chunkId":"studio-evidence-source-c1","sourceTitle":"Studio Evidence Source","excerpt":"Studio outputs should show citations, retrieval mode, and citation audit status.","score":1,"page":4,"chunkIndex":0}],"retrieval":{"mode":"persisted-keyword","persistedSourceCount":1,"vectorIndexedSourceCount":0}}',
        '{"content":"# 综述报告\\n\\n核心结论必须能追溯到来源[1]。"}',
        '{"citationAudit":{"status":"pass","citedNumbers":[1],"invalidNumbers":[],"uncitedNumbers":[],"citationCount":1,"markerCount":1}}',
        '[DONE]',
      ]),
    });
  });
  return () => hitCount;
}

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-studio-evidence-ui-'));
  const uploadPath = path.join(tempDir, 'studio-evidence.txt');
  const contrastUploadPath = path.join(tempDir, 'studio-contrast.txt');
  await writeFile(uploadPath, 'Studio evidence UI smoke source.', 'utf8');
  await writeFile(contrastUploadPath, 'Studio contrast UI smoke source.', 'utf8');

  let smokeApp;
  let browser;
  try {
    smokeApp = await resolveSmokeApp(tempDir);
    const { appOrigin } = smokeApp;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

    await interceptAccountStatus(page);
    const ingestionHits = await interceptIngestionSources(page);
    const uploadHits = await interceptUpload(page);
    const reportHits = await interceptReport(page);

    await page.goto(`${appOrigin}/?view=workbench#workbench`, { waitUntil: 'domcontentloaded' });
    await expectVisible(page.getByTestId('studio-tool-switcher'), 'Workbench Studio panel did not render.');
    await page.locator('input[type="file"]').setInputFiles([uploadPath, contrastUploadPath]);
    await expectVisible(page.getByTestId('library-selection-count').filter({ hasText: /已选 2 个(文献)?来源|已选 2 篇/ }), 'Uploaded sources were not selected.');

    await page.getByTestId('chat-generate-report').click();
    await expectVisible(page.getByTestId('citation-audit-badge').filter({ hasText: '来源已校验' }), 'Report citation audit badge did not render.');
    await expectVisible(page.getByTestId('retrieval-badge').filter({ hasText: '已匹配证据片段' }), 'Report retrieval badge did not render.');
    await expectVisible(page.getByText('1 个引用来源'), 'Report citation source toggle did not render.');
    await page.getByText('1 个引用来源').click();
    await expectVisible(page.getByText('Studio Evidence Source').first(), 'Report citation source detail did not render.');
    await page.getByTestId('chat-citation-item').first().click();
    await expectVisible(page.getByTestId('library-citation-focus').filter({ hasText: /证据定位[\s\S]*第 4 页[\s\S]*片段 1/ }), 'Library citation focus did not render after clicking report citation.');
    await expectVisible(page.getByTestId('library-citation-context').filter({ hasText: /原文片段[\s\S]*第 4 页[\s\S]*片段 1[\s\S]*Studio outputs should show citations/ }), 'Library citation context did not render source chunk text.');
    await page.getByTestId('library-paper-studio-evidence-source').click({ button: 'right' });
    await page.getByTestId('library-open-source-detail').click();
    await expectVisible(page.getByTestId('library-source-detail-panel').filter({ hasText: /来源片段[\s\S]*Studio Evidence Source/ }), 'Library source detail panel did not render.');
    await expectVisible(page.getByTestId('library-source-citation-leads').filter({ hasText: /引用线索[\s\S]*基于已入库片段/ }), 'Library source citation leads did not render.');
    await expectVisible(page.getByTestId('library-source-citation-lead').filter({ hasText: /线索 1[\s\S]*第 4 页[\s\S]*片段 1[\s\S]*Studio outputs should show citations/ }), 'Library source citation lead did not render source evidence.');
    await expectVisible(page.getByTestId('library-source-detail-chunk').filter({ hasText: /第 4 页[\s\S]*片段 1[\s\S]*Studio outputs should show citations/ }), 'Library source detail chunk did not render source text.');
    await page.getByLabel('关闭来源片段').click();
    await page.getByTestId('library-open-source-matrix').click();
    await expectVisible(page.getByTestId('library-source-matrix-panel').filter({ hasText: /文献矩阵[\s\S]*基于已选来源的本地字段对比/ }), 'Library source matrix panel did not render.');
    await expectVisible(page.getByTestId('library-source-matrix-note').filter({ hasText: /不生成跨文献结论/ }), 'Library source matrix did not explain its evidence boundary.');
    await expectVisible(page.getByTestId('library-source-matrix-row').filter({ hasText: /Studio Evidence Source[\s\S]*1 个片段[\s\S]*EvidenceUI/ }), 'Library source matrix did not render the first selected source.');
    await expectVisible(page.getByTestId('library-source-matrix-row').filter({ hasText: /Studio Contrast Source[\s\S]*1 个片段[\s\S]*ContrastUI/ }), 'Library source matrix did not render the second selected source.');

    const bodyText = await page.locator('body').innerText();
    const testKeyPrefix = ['sk', 'test'].join('-');
    const arkKeyPrefix = ['ark', 'test'].join('-');
    assert(!bodyText.includes(testKeyPrefix) && !bodyText.includes(arkKeyPrefix), 'Visible Studio evidence UI leaked a test-looking API key.');

    console.log(JSON.stringify({
      ok: true,
      appOrigin,
      managedApp: smokeApp.managed,
      checked: [
        'uploaded sources become selected',
        'central report renders citation audit badge',
        'central report renders retrieval badge',
        'central report citation source can expand',
        'central report citation click focuses source evidence in the library',
        'library citation focus renders the matched source chunk context',
        'library source detail panel lists stored source chunks',
        'library source detail panel renders source-backed citation leads',
        'library source matrix compares selected sources without AI conclusions',
        'visible evidence UI does not leak API keys',
      ],
      requests: {
        upload: uploadHits(),
        ingestionSources: ingestionHits(),
        report: reportHits(),
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
