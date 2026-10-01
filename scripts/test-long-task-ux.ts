import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function main() {
  const studioPanel = await readFile('src/components/studio/StudioPanel.tsx', 'utf-8');
  const studioJobProgress = await readFile('src/components/studio/StudioJobProgress.tsx', 'utf-8');
  const presentationPanels = await readFile('src/components/studio/PresentationPanels.tsx', 'utf-8');
  const structuredPresentationPanel = await readFile('src/components/studio/StructuredPresentationPanel.tsx', 'utf-8');
  const studioUi = [
    studioPanel,
    studioJobProgress,
    presentationPanels,
    structuredPresentationPanel,
  ].join('\n');
  const pptRoute = await readFile('src/app/api/ai/ppt/route.ts', 'utf-8');
  const pptV2Route = await readFile('src/app/api/ai/ppt-v2/route.ts', 'utf-8');

  assert.match(studioUi, /AbortController/, 'Studio PPT panels should use AbortController for cancellable long tasks.');
  assert.match(studioUi, /取消生成/, 'Long-running Studio generation should expose a visible cancel action.');
  assert.match(studioUi, /正在取消生成/, 'Cancel action should show immediate user feedback.');
  assert.match(studioUi, /已取消生成，可以调整/, 'Cancelled tasks should leave a recoverable user-facing message.');
  assert.match(studioUi, /正在生成演示文稿，可随时取消/, 'PPT generation should explain that the user can cancel while waiting.');
  assert.match(studioUi, /正在准备结构化简报生成/, 'Academic PPT generation should expose a staged long-task status without implementation jargon.');
  assert.match(studioUi, /请先在左侧选择资料/, 'Studio generation buttons should expose a clear no-source title.');

  const cancelButtons = studioUi.match(/取消生成/g) || [];
  assert.ok(cancelButtons.length >= 2, 'Image PPT and structured PPT flows should expose cancel controls.');

  assert.match(pptRoute, /text\/event-stream/, 'Image-style PPT route should stream progress events.');
  assert.match(pptRoute, /stage: 'outline'|stage": "outline"|stage:'outline'/, 'PPT route should expose an outline stage.');
  assert.match(pptRoute, /stage: 'image'|stage": "image"|stage:'image'/, 'PPT route should expose an image generation stage.');
  assert.match(pptRoute, /stage: 'narration'|stage": "narration"|stage:'narration'/, 'PPT route should expose a narration stage.');

  assert.match(pptV2Route, /X-LLM-Observability/, 'Academic PPT route should expose long-task quality/fallback observability.');

  console.log(JSON.stringify({
    ok: true,
    checked: [
      'Studio long-running PPT flows expose cancel controls',
      'Studio long-running PPT flows use AbortController',
      'Cancel action has immediate and recoverable user feedback',
      'Image-style PPT API streams outline/image/narration stages',
      'Academic PPT API exposes LLM observability for fallback warnings',
      'Studio no-source guards are visible and specific',
    ],
    cancelButtonOccurrences: cancelButtons.length,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
