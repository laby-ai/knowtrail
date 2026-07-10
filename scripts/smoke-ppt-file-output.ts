import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import JSZip from 'jszip';
import { chromium, type Page } from '@playwright/test';
import { buildAcademicPptx } from '../src/lib/ppt/academic-renderer';

const workspace = process.cwd();
const startupTimeoutMs = Number(process.env.PPT_FILE_SMOKE_TIMEOUT_MS || 45_000);

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('Unable to allocate a local PPT file smoke app port.'));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function waitForHealth(origin: string, child: ReturnType<typeof spawn>) {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`PPT file smoke app exited before /api/health completed with code ${child.exitCode}.`);
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

function killProcessTree(child?: ReturnType<typeof spawn>) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

async function resolveSmokeApp(tempDir: string) {
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

  const output: string[] = [];
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

async function expectVisible(locator: ReturnType<Page['getByText']>, message: string, timeout = 15_000) {
  await locator.waitFor({ state: 'visible', timeout }).catch(error => {
    throw new Error(`${message}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

function sse(lines: string[]) {
  return lines.map(line => `data: ${line}\n\n`).join('');
}

const pptSmokeCitations = [{
  sourceId: 'ppt-file-source',
  chunkId: 'ppt-file-source-c1',
  sourceTitle: 'PPT File-Level Source',
  snippet: 'PPT file citation',
  score: 1,
}];

const pptSmokeRetrieval = {
  mode: 'persisted-keyword',
  persistedSourceCount: 1,
  vectorIndexedSourceCount: 0,
  degraded: true,
  reason: 'embedding index not configured in PPT file smoke',
};

async function interceptUpload(page: Page) {
  let hitCount = 0;
  await page.route('**/api/upload', async route => {
    hitCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{
          id: 'ppt-file-source',
          title: 'PPT File-Level Source',
          authors: ['Smoke Test'],
          year: 2026,
          keywords: ['ppt-file-output'],
          abstract: 'Source for validating PPT file output.',
          content: '普通 PPT 和学术 PPT 都必须生成可打开的 PPTX 文件，并保留来源驱动的标题与正文。',
          rawContent: '第 1 页：File-Level PPT Slide 1。\n第 2 页：PPTX must contain slide XML and text.',
          shortName: 'PPTFile',
          fileName: 'ppt-file-output.txt',
          fileType: 'txt',
          fileSize: 220,
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

async function interceptChatStream(page: Page) {
  let hitCount = 0;
  await page.route('**/api/ai/chat', async route => {
    hitCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sse([
        '{"citations":[{"sourceId":"ppt-file-source","chunkId":"ppt-file-source-c1","sourceTitle":"PPT File-Level Source","snippet":"PPT file citation","score":1}],"retrieval":{"mode":"persisted-keyword","persistedSourceCount":1,"vectorIndexedSourceCount":0}}',
        '{"content":"已把 PPT prompt 放入中央对话。"}',
        '{"citationAudit":{"status":"pass","validMarkers":[1],"invalidMarkers":[],"missingMarkers":[]}}',
        '[DONE]',
      ]),
    });
  });
  return () => hitCount;
}

async function interceptPptSse(page: Page) {
  let hitCount = 0;
  await page.route('**/api/ai/ppt', async route => {
    hitCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sse([
        '{"stage":"outline","message":"正在生成 PPT 大纲..."}',
        '{"stage":"description","message":"正在生成页面描述..."}',
        '{"stage":"image","message":"正在生成页面 1/2","imageCompleted":1,"imageTotal":2}',
        '{"stage":"narration","message":"正在生成演讲词..."}',
        JSON.stringify({
          stage: 'evidence',
          status: 'done',
          message: '已准备可追溯证据链',
          citations: pptSmokeCitations,
          retrieval: pptSmokeRetrieval,
        }),
        JSON.stringify({
          stage: 'done',
          citations: pptSmokeCitations,
          retrieval: pptSmokeRetrieval,
          slides: [
            {
              title: 'File-Level PPT Slide 1',
              content: 'This exported PPTX must include real slide XML.',
              imageUrl: null,
              narration: 'Speaker note for slide 1.',
            },
            {
              title: 'File-Level PPT Slide 2',
              content: 'The browser export path should create a readable pptx package.',
              imageUrl: null,
              narration: 'Speaker note for slide 2.',
            },
          ],
        }),
      ]),
    });
  });
  return () => hitCount;
}

function decodeXmlText(text: string) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function inspectPptx(buffer: Buffer, expectedText: string) {
  assert(buffer.length > 1024, `PPTX buffer is too small: ${buffer.length} bytes`);
  const zip = await JSZip.loadAsync(buffer);
  const files = Object.keys(zip.files);
  assert(files.includes('[Content_Types].xml'), 'PPTX is missing [Content_Types].xml');
  assert(files.includes('ppt/presentation.xml'), 'PPTX is missing ppt/presentation.xml');
  const slideFiles = files
    .filter(file => /^ppt\/slides\/slide\d+\.xml$/.test(file))
    .sort((a, b) => Number(a.match(/slide(\d+)/)?.[1] || 0) - Number(b.match(/slide(\d+)/)?.[1] || 0));
  assert(slideFiles.length >= 2, `PPTX should contain at least 2 slides, got ${slideFiles.length}`);

  const slideTextParts = await Promise.all(slideFiles.map(async file => zip.file(file)?.async('text') || ''));
  const allText = decodeXmlText(slideTextParts.join('\n'));
  assert(allText.includes(expectedText), `PPTX slide XML did not include expected text: ${expectedText}`);

  return {
    bytes: buffer.length,
    slideCount: slideFiles.length,
    hasContentTypes: files.includes('[Content_Types].xml'),
    hasPresentationXml: files.includes('ppt/presentation.xml'),
  };
}

async function runBrowserPptExport(tempDir: string) {
  let smokeApp: Awaited<ReturnType<typeof resolveSmokeApp>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    smokeApp = await resolveSmokeApp(tempDir);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });

    const uploadHits = await interceptUpload(page);
    const chatHits = await interceptChatStream(page);
    const pptHits = await interceptPptSse(page);

    await page.goto(`${smokeApp.appOrigin}/#workbench`, { waitUntil: 'networkidle' });
    await expectVisible(page.getByText('产物中心', { exact: true }), 'Workbench product center did not render.');
    await page.locator('input[type="file"]').setInputFiles(path.join(tempDir, 'ppt-file-output.txt'));
    await expectVisible(page.getByTestId('library-selection-count').filter({ hasText: /已选 1 个文献来源|已选 1 篇/ }), 'Uploaded source was not selected.');
    await page.getByTestId('studio-nav-presentation').click();
    await page.getByTestId('image-ppt-generate').click();
    await expectVisible(page.getByText('File-Level PPT Slide 1').first(), 'Generated PPT slide preview did not render.');
    await expectVisible(page.getByTestId('studio-evidence-status'), 'PPT evidence status did not render.');
    await expectVisible(page.getByTestId('studio-retrieval-badge').getByText(/文献片段检索.*引用线索 1/), 'PPT retrieval badge did not render citation count.');
    await expectVisible(page.getByText('当前溯源说明：embedding index not configured in PPT file smoke'), 'PPT degradation reason did not render.');
    await expectVisible(page.getByText('PPT File-Level Source').first(), 'PPT citation source title did not render.');
    await expectVisible(page.getByRole('button', { name: '导出 PPTX' }), 'PPT export button did not render.');

    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
    await page.getByRole('button', { name: '导出 PPTX' }).click();
    const download = await downloadPromise;
    const savedPath = path.join(tempDir, 'browser-export.pptx');
    await download.saveAs(savedPath);
    const inspection = await inspectPptx(await readFile(savedPath), 'File-Level PPT Slide 1');

    return {
      appOrigin: smokeApp.appOrigin,
      managedApp: smokeApp.managed,
      requests: { upload: uploadHits(), chat: chatHits(), ppt: pptHits() },
      inspection,
    };
  } finally {
    await browser?.close().catch(() => undefined);
    killProcessTree(smokeApp?.child);
  }
}

async function runAcademicPptxBuild() {
  const buffer = await buildAcademicPptx(
    [{
      id: 'academic-ppt-file-source',
      title: 'Academic File-Level PPT',
      authors: ['Smoke Test'],
      year: 2026,
      abstract: 'A file-level academic PPTX build smoke.',
      content: 'Academic File-Level PPT validates the pptxgenjs backend output.',
      rawContent: 'Academic File-Level PPT validates the pptxgenjs backend output.',
      shortName: 'AcademicPPT',
      fileName: 'academic-ppt-file.txt',
      fileType: 'txt',
    }],
    [
      { type: 'cover', title: 'Academic File-Level PPT', bullets: ['Smoke Test', '2026'] },
      { type: 'background', title: '研究背景', bullets: ['后端必须生成可打开的 PPTX 文件', '文件中应包含真实 slide XML'] },
      { type: 'method', title: '验证方法', bullets: ['用 JSZip 解包', '检查 slide 数量与文本'] },
      { type: 'citation', title: '参考文献', bullets: ['PPT File-Level Source, 2026'] },
      { type: 'closing', title: '感谢聆听', bullets: ['Questions'] },
    ],
    { institution: 'generic', closingStyle: 'blue', duration: 10, audience: 'researchers', speakerNotes: false },
    [],
  );
  return inspectPptx(buffer, 'Academic File-Level PPT');
}

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-ppt-file-output-'));
  await writeFile(path.join(tempDir, 'ppt-file-output.txt'), 'PPT file output smoke source.', 'utf8');
  try {
    const browserExport = await runBrowserPptExport(tempDir);
    const academicBuild = await runAcademicPptxBuild();

    console.log(JSON.stringify({
      ok: true,
      checked: [
        'regular PPT right-panel generation renders slides from SSE',
        'regular PPT right-panel generation renders grounded evidence status and citations',
        'regular PPT browser export downloads a readable PPTX package',
        'regular PPTX contains slide XML and expected title text',
        'academic PPT-v2 backend builder returns a readable PPTX package',
        'academic PPT-v2 PPTX contains slide XML and expected title text',
      ],
      browserExport,
      academicBuild,
    }, null, 2));
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
