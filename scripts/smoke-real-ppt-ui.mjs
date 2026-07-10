import './lib/load-real-env.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import JSZip from 'jszip';
import { chromium } from '@playwright/test';

const startupTimeoutMs = Number(process.env.REAL_PPT_UI_STARTUP_TIMEOUT_MS || 45_000);
const generationTimeoutMs = Number(process.env.REAL_PPT_UI_GENERATION_TIMEOUT_MS || 1_500_000);

function envFirst(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return '';
}

function buildAiConfig() {
  return {
    apiBase: envFirst('OPENAI_COMPAT_API_BASE', 'ARK_API_BASE', 'OPENAI_API_BASE'),
    apiKey: envFirst('OPENAI_COMPAT_API_KEY', 'ARK_API_KEY', 'OPENAI_API_KEY'),
    model: envFirst('OPENAI_COMPAT_MODEL', 'ARK_MODEL'),
    visionModel: envFirst('OPENAI_COMPAT_VISION_MODEL', 'ARK_VISION_MODEL'),
    embeddingModel: envFirst('OPENAI_COMPAT_EMBEDDING_MODEL', 'ARK_EMBEDDING_MODEL'),
    ttsSpeaker: envFirst('AGENTPLAN_TTS_SPEAKER', 'DOUBAO_TTS_SPEAKER', 'AGENTPLAN_TTS_SPEAKER', 'ARK_TTS_SPEAKER'),
  };
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('Unable to allocate a local real PPT UI smoke port.'));
          return;
        }
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

async function waitForHealth(origin, child) {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`Real PPT UI smoke app exited before /api/health completed with code ${child.exitCode}.`);
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

async function expectVisible(locator, message, timeout = 120_000) {
  await locator.waitFor({ state: 'visible', timeout }).catch(error => {
    throw new Error(`${message}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

async function captureWorkbenchState(page) {
  return page.evaluate(() => {
    const text = document.body.innerText || '';
    const nav = Array.from(document.querySelectorAll('[data-testid^="studio-nav-"]')).map(element => ({
      testId: element.getAttribute('data-testid'),
      pressed: element.getAttribute('aria-pressed'),
      text: (element.textContent || '').trim(),
    }));
    const selected = document.querySelector('[data-testid="library-selection-count"]')?.textContent?.trim() || '';
    const academicPanel = Boolean(document.querySelector('[data-testid="academic-ppt-panel"]'));
    const academicGenerating = text.includes('真实模型长任务');
    const academicSuccess = Boolean(document.querySelector('[data-testid="academic-ppt-success"]'));
    const visibleTail = text.slice(-2000);
    return {
      url: location.href,
      selected,
      nav,
      academicPanel,
      academicGenerating,
      academicSuccess,
      visibleTail,
    };
  }).catch(error => ({ error: error instanceof Error ? error.message : String(error) }));
}

async function waitForUploadedSource(origin, expected) {
  const deadline = Date.now() + 180_000;
  let lastBody = '';
  while (Date.now() < deadline) {
    const response = await fetch(`${origin}/api/ingestion/sources`, { cache: 'no-store' });
    const body = await response.json();
    lastBody = JSON.stringify(body);
    const source = body.sources?.find(item => (
      (expected.id && item.id === expected.id)
      || (!expected.id && item.fileName === expected.fileName)
    ));
    if (source?.id && source.status === 'succeeded' && source.chunkCount > 0) return source;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for uploaded source ${expected.id || expected.fileName}. Last body: ${lastBody}`);
}

async function parseUploadResponse(response) {
  const status = response.status();
  const text = await response.text().catch(error => `<<failed to read upload response: ${error instanceof Error ? error.message : String(error)}>>`);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Upload response was not JSON. status=${status}, body=${text.slice(0, 1000)}`);
  }

  if (!response.ok || body?.success !== true) {
    throw new Error(`Upload failed before ingestion. status=${status}, body=${JSON.stringify(body).slice(0, 1200)}`);
  }

  const failures = (body.results || []).filter(item => item?.error);
  if (failures.length > 0) {
    throw new Error(`Upload returned per-file errors: ${JSON.stringify(failures).slice(0, 1200)}`);
  }

  const uploaded = (body.results || [])[0];
  if (!uploaded?.id) {
    throw new Error(`Upload response did not include a source id: ${JSON.stringify(body).slice(0, 1200)}`);
  }

  return uploaded;
}

function extractTextFromXml(xml) {
  return Array.from(xml.matchAll(/<a:t>(.*?)<\/a:t>/g))
    .map(match => match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
    .join(' ');
}

async function auditPptx(filePath) {
  const buffer = await import('node:fs/promises').then(fs => fs.readFile(filePath));
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0) - Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0));
  const rows = [];
  for (const name of slideFiles) {
    const xml = await zip.file(name).async('string');
    const text = extractTextFromXml(xml);
    rows.push({
      slide: path.basename(name),
      textLength: text.length,
      placeholder: /TODO|占位|placeholder|lorem ipsum/i.test(text),
      thin: text.length < 40,
      sample: text.slice(0, 120),
    });
  }
  const placeholderCount = rows.filter(row => row.placeholder).length;
  const thinSlideCount = rows.filter(row => row.thin).length;
  return {
    bytes: buffer.length,
    slideCount: slideFiles.length,
    placeholderCount,
    thinSlideCount,
    rows,
  };
}

async function startApp(tempDir) {
  if (process.env.REAL_PPT_UI_ORIGIN) {
    return { origin: process.env.REAL_PPT_UI_ORIGIN.replace(/\/$/, ''), child: null, external: true };
  }

  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['scripts/start.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_RUNTIME_ENV: process.env.REAL_PPT_UI_RUNTIME_ENV || 'production',
      NODE_ENV: process.env.REAL_PPT_UI_RUNTIME_ENV || 'production',
      FILE_STORAGE_ADAPTER: process.env.REAL_PPT_UI_FILE_STORAGE_ADAPTER || process.env.FILE_STORAGE_ADAPTER || 'local',
      PORT: String(port),
      DEPLOY_RUN_PORT: String(port),
      INTERNAL_APP_ORIGIN: '',
      SOURCE_STORE_PATH: path.join(tempDir, 'sources.json'),
      ZVEC_STORE_PATH: path.join(tempDir, 'zvec'),
      AI_TEST_CONFIG_TEXT_TIMEOUT_MS: process.env.AI_TEST_CONFIG_TEXT_TIMEOUT_MS || '45000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
  });
  return { origin, child, external: false };
}

async function main() {
  const aiConfig = buildAiConfig();
  const missing = [
    aiConfig.apiBase ? '' : 'OPENAI_COMPAT_API_BASE or ARK_API_BASE',
    aiConfig.apiKey ? '' : 'OPENAI_COMPAT_API_KEY or ARK_API_KEY',
    aiConfig.model ? '' : 'OPENAI_COMPAT_MODEL or ARK_MODEL',
    aiConfig.embeddingModel ? '' : 'OPENAI_COMPAT_EMBEDDING_MODEL or ARK_EMBEDDING_MODEL',
  ].filter(Boolean);

  if (missing.length > 0) {
    console.log(JSON.stringify({ ok: true, skipped: true, realService: false, missing }, null, 2));
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-real-ppt-ui-'));
  const evidenceDir = path.resolve('.deploy/evidence');
  await mkdir(evidenceDir, { recursive: true });
  const uploadFileName = `real-ppt-ui-${Date.now()}.txt`;
  const uploadPath = path.join(tempDir, uploadFileName);
  await writeFile(uploadPath, [
    '灵笔工作室右侧 Studio PPT 浏览器真实路径 smoke 资料。',
    '用户在 NotebookLM-like 工作台中上传资料后，右侧 Studio 的学术报告 PPT 必须复用同一 grounded context。',
    'PPT 长任务必须展示阶段进度、真实模型等待提示、取消入口和完成后的下载入口。',
    '生成结果必须是可打开的真实 PPTX 文件，且不能出现 fallback 产物、占位符页或内容过薄页。',
  ].join('\n'), 'utf8');

  const { origin, child, external } = await startApp(tempDir);
  const output = [];
  child?.stdout.on('data', chunk => output.push(String(chunk)));
  child?.stderr.on('data', chunk => output.push(String(chunk)));

  let browser;
  const startedAt = Date.now();
  try {
    const health = await waitForHealth(origin, child);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    const responses = { upload: 0, pptV2: 0 };
    const clientEvents = [];
    let pptRequestSeenAt = 0;
    page.on('console', message => {
      clientEvents.push({ type: `console:${message.type()}`, text: message.text().slice(0, 500) });
    });
    page.on('pageerror', error => {
      clientEvents.push({ type: 'pageerror', text: error.message.slice(0, 500) });
    });
    page.on('requestfailed', request => {
      clientEvents.push({
        type: 'requestfailed',
        url: request.url(),
        text: request.failure()?.errorText || '',
      });
    });
    page.on('response', response => {
      const url = response.url();
      if (url.endsWith('/api/upload')) responses.upload += 1;
      if (url.endsWith('/api/ai/ppt-v2')) {
        responses.pptV2 += 1;
        clientEvents.push({
          type: 'response:ppt-v2',
          status: response.status(),
          contentType: response.headers()['content-type'] || '',
          observabilityPresent: Boolean(response.headers()['x-llm-observability']),
        });
      }
    });

    await page.addInitScript(config => {
      window.localStorage.setItem('lingbi-ai-config', JSON.stringify(config));
    }, aiConfig);

    await page.goto(`${origin}/#workbench`, { waitUntil: 'networkidle' });
    await expectVisible(page.getByText('产物中心', { exact: true }), 'Workbench product center did not render.', 30_000);
    const uploadResponsePromise = page.waitForResponse(response => response.url().includes('/api/upload'), { timeout: 180_000 })
      .then(async response => ({ kind: 'upload-response', uploaded: await parseUploadResponse(response) }));
    const sourcePromise = waitForUploadedSource(origin, { fileName: uploadFileName })
      .then(source => ({ kind: 'source-store', source }));
    await page.locator('input[type="file"]').setInputFiles(uploadPath);
    const uploadEvidence = await Promise.race([uploadResponsePromise, sourcePromise]);
    const uploaded = uploadEvidence.kind === 'upload-response'
      ? await waitForUploadedSource(origin, { id: uploadEvidence.uploaded.id, fileName: uploadFileName })
      : uploadEvidence.source;
    const titleLocator = page.getByText(uploaded.title || uploaded.fileName).first();
    await expectVisible(titleLocator, 'Uploaded real PPT source title did not render.', 60_000);
    const paperRow = page.getByTestId(`library-paper-${uploaded.id}`).first();
    await expectVisible(paperRow, 'Uploaded real PPT source row did not expose a selectable test id.', 60_000);
    const selectedCount = page.getByTestId('library-selection-count').first();
    if (await page.getByTestId('library-selection-count').count() === 0 || await paperRow.getAttribute('aria-selected') !== 'true') {
      await paperRow.click();
    }
    await expectVisible(selectedCount.filter({ hasText: /已选 1 个文献来源|已选 1 篇/ }), 'Uploaded real PPT source could not be selected.', 30_000);

    await page.getByTestId('studio-nav-presentation').click();
    await page.getByTestId('presentation-mode-structured').click();
    await expectVisible(page.getByTestId('academic-ppt-panel'), 'Academic PPT tab did not render.', 30_000);
    await page.getByTestId('academic-ppt-outline-confirm').click();
    await expectVisible(page.getByText('演讲时长'), 'Academic PPT duration control did not render.', 30_000);
    const durationSlider = page.getByTestId('academic-ppt-duration');
    await durationSlider.evaluate(element => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(element, '5');
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expectVisible(page.getByText('5 分钟'), 'Academic PPT duration slider did not switch to 5 minutes.', 30_000);

    const pptRequestPromise = page.waitForRequest(request => request.url().endsWith('/api/ai/ppt-v2'), { timeout: 30_000 });
    const generateButton = page.getByTestId('academic-ppt-generate');
    await expectVisible(generateButton, 'Academic PPT generate button did not render.', 30_000);
    if (await generateButton.isDisabled()) {
      throw new Error('Academic PPT generate button stayed disabled after selecting the uploaded source.');
    }
    await generateButton.click();
    const pptRequest = await pptRequestPromise;
    pptRequestSeenAt = Date.now();
    clientEvents.push({
      type: 'request:ppt-v2',
      method: pptRequest.method(),
      postDataLength: pptRequest.postData()?.length || 0,
    });
    await expectVisible(page.getByText('真实模型长任务'), 'Academic PPT long-task waiting panel did not render.', 30_000);
    await expectVisible(page.getByText('取消生成'), 'Academic PPT cancel action did not render.', 30_000);
    await expectVisible(page.getByText(/论证分析|图表匹配|大纲规划|质量审查|构建PPTX/).first(), 'Academic PPT staged progress did not render.', 30_000);
    await expectVisible(page.getByTestId('academic-ppt-success'), 'Academic PPT did not complete in the browser.', generationTimeoutMs)
      .catch(async error => {
        const state = await captureWorkbenchState(page);
        throw new Error(`${error instanceof Error ? error.message : String(error)}\nWorkbench state:\n${JSON.stringify(state, null, 2)}\nResponses:\n${JSON.stringify(responses, null, 2)}\nPPT request age ms: ${pptRequestSeenAt ? Date.now() - pptRequestSeenAt : null}\nClient events:\n${JSON.stringify(clientEvents.slice(-40), null, 2)}`);
      });
    await expectVisible(page.getByTestId('academic-ppt-quality-summary'), 'Academic PPT did not show real model quality summary.', 30_000)
      .catch(async error => {
        const state = await captureWorkbenchState(page);
        throw new Error(`${error instanceof Error ? error.message : String(error)}\nWorkbench state:\n${JSON.stringify(state, null, 2)}\nResponses:\n${JSON.stringify(responses, null, 2)}\nClient events:\n${JSON.stringify(clientEvents.slice(-40), null, 2)}`);
      });

    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByTestId('academic-ppt-download').click();
    const download = await downloadPromise;
    const outputPath = path.join(evidenceDir, `real-ppt-ui-${new Date().toISOString().replace(/[:.]/g, '-')}.pptx`);
    await download.saveAs(outputPath);
    const pptAudit = await auditPptx(outputPath);
    if (pptAudit.slideCount < 5 || pptAudit.placeholderCount > 0 || pptAudit.thinSlideCount > 0) {
      throw new Error(`Downloaded PPTX quality audit failed: ${JSON.stringify(pptAudit)}`);
    }

    console.log(JSON.stringify({
      ok: true,
      realService: true,
      origin,
      externalOrigin: external,
      durationMs: Date.now() - startedAt,
      health: {
        service: health.service,
        sourceStore: health.capabilities?.sourceStore,
        vectorStore: health.capabilities?.vectorStore,
      },
      uploaded: {
        sourceId: uploaded.id,
        status: uploaded.status,
        chunkCount: uploaded.chunkCount,
        fileName: uploaded.fileName,
      },
      checked: [
        'browser opened real workbench',
        'browser uploaded and selected a real source',
        'right Studio academic PPT tab rendered',
        'duration was reduced to 5 minutes through UI control',
        'long-task waiting panel, staged progress, and cancel action rendered',
        'real PPT-v2 completed in the browser',
        'browser download created a real PPTX file',
        'downloaded PPTX passed package/text quality audit',
      ],
      responses,
      clientEvents: clientEvents.slice(-20),
      outputPath,
      pptAudit,
    }, null, 2));
  } catch (error) {
    const recentOutput = output.join('').slice(-2000);
    throw new Error(`${error instanceof Error ? error.message : String(error)}${recentOutput ? `\nRecent server output:\n${recentOutput}` : ''}`);
  } finally {
    await browser?.close().catch(() => undefined);
    if (!external) killProcessTree(child);
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
