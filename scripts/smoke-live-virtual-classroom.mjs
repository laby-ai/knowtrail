import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  selectVerifiedClassroom,
  validateBrowserProbe,
  validateClassroomExport,
  validateSharedStoreLink,
} from './lib/live-virtual-classroom-smoke.mjs';

const liveOrigin = (process.env.LIVE_CLASSROOM_ORIGIN || 'https://airai.world').replace(/\/$/, '');
const statusPath = process.env.LIVE_CLASSROOM_STATUS_PATH || '/lingbi/api/virtual-classroom/status';
const expectedClassroomId = process.env.LIVE_CLASSROOM_ID || '';
const browserEnabled = process.env.LIVE_CLASSROOM_BROWSER !== '0';
const storeLink = process.env.LIVE_CLASSROOM_STORE_LINK || '';
const expectedStore = process.env.LIVE_CLASSROOM_EXPECTED_STORE || '/opt/knowtrail/shared/virtual-classroom';
const outDir = path.resolve(process.env.LIVE_CLASSROOM_OUTPUT_DIR || path.join('output', 'playwright'));

async function fetchChecked(url, expectedType) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  if (expectedType && !contentType.includes(expectedType)) {
    throw new Error(`${url} returned unexpected content type ${contentType || 'unknown'}.`);
  }
  return response;
}

async function runBrowser(classroomUrl) {
  let chromium;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    throw new Error('Playwright is required for browser probes. Install dev dependencies or set LIVE_CLASSROOM_BROWSER=0 for the server-only probe.');
  }

  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const item of [
      { name: 'desktop', viewport: { width: 1440, height: 1000 } },
      { name: 'mobile', viewport: { width: 390, height: 844 } },
    ]) {
      const page = await browser.newPage({ viewport: item.viewport });
      const errors = [];
      const failedResponses = [];
      page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() });
      });

      await page.goto(classroomUrl, { waitUntil: 'networkidle', timeout: 60_000 });
      await page.waitForFunction(
        () => !document.body.innerText.includes('Loading classroom...'),
        undefined,
        { timeout: 30_000 },
      );
      const dimensions = await page.evaluate(() => ({
        text: document.body.innerText || '',
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      const screenshot = path.join(outDir, `live-virtual-classroom-${item.name}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      results.push({
        ...validateBrowserProbe({
          viewport: item.name,
          ...dimensions,
          errors,
          failedResponses,
        }),
        screenshot,
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return results;
}

async function main() {
  const statusUrl = new URL(statusPath, `${liveOrigin}/`).toString();
  const statusResponse = await fetchChecked(statusUrl, 'application/json');
  const status = await statusResponse.json();
  const classroom = selectVerifiedClassroom(status, expectedClassroomId);
  const classroomUrl = new URL(classroom.url, `${liveOrigin}/`).toString();
  const exportUrl = new URL(classroom.exportUrl, `${liveOrigin}/`).toString();

  const pageResponse = await fetchChecked(classroomUrl, 'text/html');
  const html = await pageResponse.text();
  if (!html.includes('_next/static')) throw new Error('Classroom HTML does not reference its runtime assets.');

  const exportResponse = await fetchChecked(exportUrl, 'application/json');
  const exportSummary = validateClassroomExport(await exportResponse.json(), classroom.id);
  const sharedStore = storeLink
    ? validateSharedStoreLink(await realpath(storeLink), expectedStore)
    : { ok: true, skipped: true };
  const browser = browserEnabled ? await runBrowser(classroomUrl) : [];

  console.log(JSON.stringify({
    ok: true,
    liveOrigin,
    statusUrl,
    classroom: {
      id: classroom.id,
      scenes: classroom.scenesCount,
      actions: classroom.actionsCount,
      url: classroomUrl,
    },
    export: exportSummary,
    sharedStore,
    browser,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
