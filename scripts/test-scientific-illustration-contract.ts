import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildScientificIllustrationPrompt,
  inspectGeneratedImage,
  parseScientificIllustrationRequest,
} from '../src/lib/scientific-illustration-contract';
import {
  readScientificIllustration,
  saveScientificIllustration,
} from '../src/lib/scientific-illustration-store';

async function main() {
const validRequest = parseScientificIllustrationRequest({
  purpose: '展示样本进入质控、特征提取和结果复核的研究流程',
  figureKind: 'workflow',
  aspectRatio: '16:9',
  requiredLabels: ['样本进入', '质量控制', '特征提取', '结果复核'],
  notebookId: 'notebook-1',
  papers: [{
    id: 'paper-1',
    shortName: 'Source A',
    title: 'A reproducible workflow',
    abstract: 'The workflow separates quality control from feature extraction and final review.',
    content: 'Samples enter quality control before feature extraction. Results are reviewed before reporting.',
  }],
});

assert.equal(validRequest.figureKind, 'workflow');
assert.equal(validRequest.requiredLabels.length, 4);
assert.throws(
  () => parseScientificIllustrationRequest({ ...validRequest, figureKind: 'statistical-chart' }),
  /不支持/,
);
assert.throws(
  () => parseScientificIllustrationRequest({ ...validRequest, papers: [] }),
  /来源/,
);
assert.throws(
  () => parseScientificIllustrationRequest({ ...validRequest, requiredLabels: ['1', '2', '3', '4', '5', '6', '7'] }),
  /6/,
);

const prompt = buildScientificIllustrationPrompt(validRequest);
assert.match(prompt, /科研示意图/);
assert.match(prompt, /样本进入/);
assert.match(prompt, /Source A/);
assert.match(prompt, /不得绘制统计图/);
assert.match(prompt, /不得虚构显著性/);
assert.doesNotMatch(prompt, /已完成统计分析/);

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nH0AAAAASUVORK5CYII=',
  'base64',
);
const imageInfo = inspectGeneratedImage(onePixelPng);
assert.deepEqual(
  { mimeType: imageInfo.mimeType, extension: imageInfo.extension, width: imageInfo.width, height: imageInfo.height },
  { mimeType: 'image/png', extension: 'png', width: 1, height: 1 },
);
assert.throws(() => inspectGeneratedImage(Buffer.from('not-an-image')), /图片格式/);

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-scientific-illustration-'));
process.env.SCIENTIFIC_ILLUSTRATION_STORE_DIR = tempDir;
try {
  const saved = await saveScientificIllustration({
    image: onePixelPng,
    ownerMemberId: 'member-a',
    notebookId: 'notebook-1',
    purpose: validRequest.purpose,
    figureKind: validRequest.figureKind,
    aspectRatio: validRequest.aspectRatio,
    sourceLabels: ['Source A'],
  });
  const loaded = await readScientificIllustration(saved.id, 'member-a');
  assert.equal(loaded.metadata.ownerMemberId, 'member-a');
  assert.deepEqual(await readFile(loaded.imagePath), onePixelPng);
  await assert.rejects(() => readScientificIllustration(saved.id, 'member-b'), /无权访问/);
  await assert.rejects(() => readScientificIllustration('../escape', 'member-a'), /不存在/);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  delete process.env.SCIENTIFIC_ILLUSTRATION_STORE_DIR;
}

const routeSource = await readFile(
  path.join(process.cwd(), 'src/app/api/ai/scientific-illustration/route.ts'),
  'utf8',
);
const fileRouteSource = await readFile(
  path.join(process.cwd(), 'src/app/api/ai/scientific-illustration/[id]/route.ts'),
  'utf8',
);
const panelSource = await readFile(
  path.join(process.cwd(), 'src/components/studio/ScientificIllustrationPanel.tsx'),
  'utf8',
);
const taxonomySource = await readFile(
  path.join(process.cwd(), 'src/lib/studio-research-taxonomy.ts'),
  'utf8',
);
const studioPanelSource = await readFile(
  path.join(process.cwd(), 'src/components/studio/StudioPanel.tsx'),
  'utf8',
);
const imageGenerationSource = await readFile(
  path.join(process.cwd(), 'src/lib/ppt/image-generation.ts'),
  'utf8',
);
const legacyPptRouteSource = await readFile(
  path.join(process.cwd(), 'src/app/api/ai/ppt/route.ts'),
  'utf8',
);

assert.match(routeSource, /resolveAccountNotebookScope/);
assert.match(routeSource, /reserveAIUsage/);
assert.match(routeSource, /productArea:\s*'ai\.image'/);
assert.match(routeSource, /generateSlideImage/);
assert.match(routeSource, /saveScientificIllustration/);
assert.match(fileRouteSource, /readScientificIllustration/);
assert.match(fileRouteSource, /Content-Disposition/);
assert.match(panelSource, /科研示意图，不是数据图表/);
assert.match(panelSource, /scientific-illustration-start/);
assert.match(panelSource, /scientific-illustration-download/);
assert.match(panelSource, /URL\.revokeObjectURL/);
assert.match(taxonomySource, /id: 'scientific-illustration'/);
assert.match(taxonomySource, /label: '科研绘图'/);
assert.match(studioPanelSource, /ScientificIllustrationPanel/);
assert.doesNotMatch(panelSource, /数据对比|结果可视化|插入报告|FALLBACK_GRADIENTS/);
for (const providerSource of [imageGenerationSource, legacyPptRouteSource]) {
  assert.match(
    providerSource,
    /ARK_IMAGE_API_KEY[\s\S]{0,160}runtimeConfig\.apiKey[\s\S]{0,80}ARK_AGENTPLAN_API_KEY/,
    'Standard image credentials must take precedence over the AgentPlan-only key.',
  );
}

console.log(JSON.stringify({
  ok: true,
  checked: [
    'scientific illustration request and prompt preserve the schematic-only boundary',
    'generated bytes must be a real PNG, JPEG, or WebP image',
    'stored files are isolated by account member',
    'route preserves account scope, ai.image billing, real provider, persistence, preview, and download',
    'standard image credentials take precedence over AgentPlan-only credentials',
    'Studio exposes a real scientific illustration product without data-chart claims or simulated fallbacks',
  ],
}, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
