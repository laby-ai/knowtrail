import { NextRequest, NextResponse } from 'next/server';
import { llmInvoke } from '@/lib/ai-service';
import { buildGroundedRetrievalContext, toRetrievalMetadata } from '@/lib/grounded-retrieval';
import { allowRequestRuntimeAIConfig, hasRuntimeAIProvider, redactRuntimeAISecrets } from '@/lib/runtime-ai-config';
import type { RagSourceInput } from '@/lib/rag';
import type { RuntimeAIConfig } from '@/types';
import { DETAIL_LEVEL_SPECS, getStyleDescription, PPT_LANG_INSTRUCTION } from '@/lib/ppt/image-ppt-style';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import {
  resolveStudioGenerationReadiness,
  studioGenerationUnavailablePayload,
} from '@/lib/studio-generation-readiness';

// ============================================================
// Banana Slides PPT Generation Pipeline (Strict Alignment)
// Original Flow: genOutline → flattenOutline → genDesc(parallel) → genPrompts → genImages(parallel)
// Image Generation: 思坦AI (images.sitianai.com) — 学术科研图像平台
// Reference: banana-slides-main/backend/services/prompts.py + task_manager.py
// ============================================================

// --- 思坦AI 配置 ---
const SITIAN_API_BASE = process.env.SITIAN_API_BASE || 'http://images.sitianai.com';
const SITIAN_API_TOKEN = process.env.SITIAN_API_TOKEN || '';

interface SitianResponse {
  success: boolean;
  candidates?: Array<{
    index: number;
    images?: Array<{
      mimeType: string;
      data: string; // base64 encoded image data
    }>;
  }>;
  elapsed?: number;
  access?: {
    dailyImageLimit: number;
    usedToday: number;
    remainingToday: number;
  };
}

interface OpenAIImageResponse {
  data?: Array<{
    b64_json?: string;
    url?: string;
  }>;
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
}

function envFirst(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return '';
}

function resolveServerRuntimeAIConfig(input?: Partial<RuntimeAIConfig>): Partial<RuntimeAIConfig> {
  if (allowRequestRuntimeAIConfig() && hasRuntimeAIProvider(input)) return input;
  return {
    apiBase: envFirst('OPENAI_COMPAT_API_BASE', 'ARK_API_BASE', 'OPENAI_API_BASE'),
    apiKey: envFirst('OPENAI_COMPAT_API_KEY', 'ARK_API_KEY', 'OPENAI_API_KEY'),
    model: envFirst('OPENAI_COMPAT_MODEL', 'ARK_MODEL'),
    visionModel: envFirst('OPENAI_COMPAT_VISION_MODEL', 'OPENAI_COMPAT_IMAGE_MODEL', 'ARK_IMAGE_MODEL', 'ARK_VISION_MODEL'),
    embeddingModel: envFirst('OPENAI_COMPAT_EMBEDDING_MODEL', 'ARK_EMBEDDING_MODEL'),
    ttsSpeaker: envFirst('AGENTPLAN_TTS_SPEAKER', 'ARK_TTS_SPEAKER'),
  };
}

function normalizeOpenAIImageEndpoint(apiBase: string): string {
  const trimmed = apiBase.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/images/generations')) return trimmed;
  if (trimmed.endsWith('/chat/completions')) return `${trimmed.slice(0, -'/chat/completions'.length)}/images/generations`;
  if (trimmed.endsWith('/embeddings')) return `${trimmed.slice(0, -'/embeddings'.length)}/images/generations`;
  if (/\/v\d+$/i.test(trimmed)) return `${trimmed}/images/generations`;
  return `${trimmed}/v1/images/generations`;
}

function resolveImageApiBase(runtimeConfig: Partial<RuntimeAIConfig>): string {
  const explicit = envFirst('OPENAI_COMPAT_IMAGE_API_BASE', 'ARK_IMAGE_API_BASE');
  if (explicit) return explicit;
  const base = runtimeConfig.apiBase || '';
  // Ark Agent Plan (/api/plan/v3) can work for text/TTS packages but image
  // generation models use the standard Ark-compatible /api/v3 endpoint.
  return base.replace(/\/api\/plan\/v(\d+)\/?$/i, '/api/v$1');
}

function resolveImageApiKey(runtimeConfig: Partial<RuntimeAIConfig>): string {
  return envFirst(
    'OPENAI_COMPAT_IMAGE_API_KEY',
    'ARK_IMAGE_API_KEY',
  ) || runtimeConfig.apiKey || envFirst('ARK_AGENTPLAN_API_KEY');
}

function resolveImageModel(runtimeConfig?: Partial<RuntimeAIConfig>): string {
  const explicitImageModel = envFirst('OPENAI_COMPAT_IMAGE_MODEL', 'ARK_IMAGE_MODEL');
  if (explicitImageModel) return explicitImageModel;
  const candidate = runtimeConfig?.visionModel?.trim() || envFirst('OPENAI_COMPAT_VISION_MODEL', 'ARK_VISION_MODEL');
  if (/seedream|image|imagen|dall-e|gpt-image/i.test(candidate)) return candidate;
  return 'doubao-seedream-5-0-lite-260128';
}

function imageSizeForAspectRatio(aspectRatio?: string): string {
  if (aspectRatio === '4:3') return '2560x1920';
  if (aspectRatio === '1:1') return '2048x2048';
  return '2560x1440';
}

async function imageUrlToBase64(url: string, apiKey?: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(Number(process.env.PPT_IMAGE_FETCH_TIMEOUT_MS || 60_000)),
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    throw new Error(`图片 URL 下载失败：HTTP ${response.status}${raw ? ` - ${redactRuntimeAISecrets(raw, apiKey)}` : ''}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString('base64');
}

/**
 * 调用思坦AI生成学术风格图片（同步接口）
 * 返回 base64 图片数据字符串，失败返回 null
 */
async function generateSitianImage(prompt: string, options?: {
  aspectRatio?: string;
  negativePrompt?: string;
  referenceImageBase64?: string;
}): Promise<string | null> {
  try {
    const body: Record<string, unknown> = {
      prompt,
      aspectRatio: options?.aspectRatio || '16:9',
      numberOfImages: 1,
      outputMimeType: 'image/png',
      addWatermark: false,
    };

    if (options?.negativePrompt) body.negativePrompt = options.negativePrompt;
    if (options?.referenceImageBase64) {
      body.imageBase64 = options.referenceImageBase64;
      body.imageMimeType = 'image/jpeg';
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = SITIAN_API_TOKEN;
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const resp = await fetch(`${SITIAN_API_BASE}/api/generate`, {
      method: 'POST', headers, body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) { console.error(`[SitianAI] HTTP ${resp.status}`); return null; }

    const data: SitianResponse = await resp.json();
    if (!data.success) return null;

    const imageBase64 = data.candidates?.[0]?.images?.[0]?.data;
    if (!imageBase64) return null;

    if (data.access) console.log(`[SitianAI] 额度: ${data.access.usedToday}/${data.access.dailyImageLimit}, 剩余${data.access.remainingToday}`);
    if (data.elapsed) console.log(`[SitianAI] 耗时: ${(data.elapsed / 1000).toFixed(1)}s`);

    return imageBase64;
  } catch (err) {
    console.error('[SitianAI] Generate error:', err);
    return null;
  }
}

async function generateOpenAICompatibleImage(
  prompt: string,
  runtimeConfig: Partial<RuntimeAIConfig>,
  options?: { aspectRatio?: string; negativePrompt?: string; referenceImageBase64?: string },
): Promise<string> {
  if (!hasRuntimeAIProvider(runtimeConfig)) {
    throw new Error('账号绑定的图片模型服务尚未配置，请稍后再试。');
  }

  const endpoint = normalizeOpenAIImageEndpoint(resolveImageApiBase(runtimeConfig));
  const apiKey = resolveImageApiKey(runtimeConfig);
  const model = resolveImageModel(runtimeConfig);
  const size = imageSizeForAspectRatio(options?.aspectRatio);
  const promptWithGuards = [
    prompt,
    options?.negativePrompt ? `\nNegative prompt: ${options.negativePrompt}` : '',
    options?.referenceImageBase64 ? '\nUse the supplied reference image only as visual style guidance; do not copy text from it.' : '',
  ].join('');

  const requestBody: Record<string, unknown> = {
    model,
    prompt: promptWithGuards,
    size,
    response_format: 'b64_json',
    watermark: false,
  };
  if (options?.referenceImageBase64) requestBody.image = options.referenceImageBase64;

  console.log(`[PPT Image] 调用真实图片模型 ${model} (${size})...`);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(Number(process.env.PPT_IMAGE_TIMEOUT_MS || 180_000)),
  });

  const rawBody = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`真实图片模型 API 失败：HTTP ${response.status}${rawBody ? ` - ${redactRuntimeAISecrets(rawBody, apiKey)}` : ''}`);
  }

  let parsed: OpenAIImageResponse;
  try {
    parsed = JSON.parse(rawBody) as OpenAIImageResponse;
  } catch {
    throw new Error(`真实图片模型返回非 JSON：${redactRuntimeAISecrets(rawBody.slice(0, 300), apiKey)}`);
  }

  const first = parsed.data?.[0];
  if (first?.b64_json) return first.b64_json;
  if (first?.url) return imageUrlToBase64(first.url, apiKey);
  const message = parsed.error?.message ? redactRuntimeAISecrets(parsed.error.message, apiKey) : '';
  throw new Error(`真实图片模型未返回图片数据${message ? `：${message}` : ''}`);
}

/**
 * 统一生图入口：优先思坦AI；未配置或失败时走真实 OpenAI-compatible/Ark 图片模型。
 */
async function generateImage(prompt: string, options?: {
  aspectRatio?: string;
  negativePrompt?: string;
  referenceImageBase64?: string;
  runtimeConfig?: Partial<RuntimeAIConfig>;
}): Promise<string | null> {
  // 1. 优先尝试思坦AI
  if (SITIAN_API_TOKEN) {
    console.log('[生图] 尝试思坦AI...');
    const result = await generateSitianImage(prompt, options);
    if (result) return result;
    console.log('[生图] 思坦AI失败，改用真实 OpenAI-compatible 图片模型...');
  } else {
    console.log('[生图] 未配置思坦AI Token，使用真实 OpenAI-compatible 图片模型...');
  }

  return generateOpenAICompatibleImage(prompt, resolveServerRuntimeAIConfig(options?.runtimeConfig), options);
}

// ============================================================
// Types (aligned with banana-slides OutlinePage/OutlinePart)
// ============================================================

interface PPTRequest {
  papers: RagSourceInput[];
  style?: string;              // preset style id (e.g. 'academic-formal')
  pageCount?: number;
  templateStyle?: string;     // custom style description text
  detailLevel?: 'concise' | 'default' | 'detailed';
  language?: 'zh' | 'en' | 'ja' | 'auto';
  aspectRatio?: string;       // e.g. '16:9', '4:3', '1:1'
  referenceImageIndex?: number | null; // index into source-media images (0-26), null = no reference
  aiConfig?: Partial<RuntimeAIConfig>;
  debugRetrievalOnly?: boolean;
  notebookId?: string;
}

// ============================================================
// Banana Slides 8 Preset Styles (from presetStyles.ts + presetStylesI18n.ts)
// Each style has a detailed visual description prompt for image generation
// ============================================================
interface OutlinePage {
  title: string;
  points: string[];
  part?: string;
}

interface OutlinePart {
  part: string;
  pages: OutlinePage[];
}

type OutlineItem = OutlinePage | OutlinePart;

interface SlideDesc {
  pageTitle: string;
  pageText: string;
  imageMaterial?: string; // 图片素材部分
}

interface ImageGenerationResult {
  imageBase64: string | null;
  error?: string;
}

// ============================================================
// Step 1: Generate outline (banana-slides get_outline_generation_prompt)
// Supports simple format + part-based format, JSON output
// ============================================================
async function genOutline(
  ideaPrompt: string,
  language: string = 'zh',
  pageCount: number = 8,
  runtimeConfig?: Partial<RuntimeAIConfig>,
): Promise<OutlineItem[]> {
  const langInstruction = language === 'en' ? 'Please output all in English.'
    : language === 'ja' ? 'すべて日本語で出力してください。'
    : language === 'auto' ? ''
    : '请使用全中文输出。';

  const outlinePrompt = `You are a helpful assistant that generates an outline for a presentation.

You can organize the content in two ways:

1. Simple format (for short presentations without major sections):
[{"title": "title1", "points": ["point1", "point2"]}, {"title": "title2", "points": ["point1", "point2"]}]

2. Part-based format (for longer presentations with major sections):
[
  {
    "part": "Part 1: Introduction",
    "pages": [
      {"title": "Welcome", "points": ["point1", "point2"]},
      {"title": "Overview", "points": ["point1", "point2"]}
    ]
  },
  {
    "part": "Part 2: Main Content",
    "pages": [
      {"title": "Topic 1", "points": ["point1", "point2"]},
      {"title": "Topic 2", "points": ["point1", "point2"]}
    ]
  }
]

Choose the format that best fits the content. Use parts when the presentation has clear major sections.
Unless otherwise specified, the first page should be kept simplest, containing only the title, subtitle, and presenter information.

The user's request: ${ideaPrompt}

!! CRITICAL PAGE COUNT RULE !!
The user requested EXACTLY ${pageCount} pages/slides in the outline.
- You MUST generate EXACTLY ${pageCount} page entries in total across all parts.
- Count every page object carefully before outputting.
- If you have too few pages, add more detail pages. If you have too many, merge or remove pages.
- DO NOT generate more or fewer than ${pageCount} pages. This is a hard requirement.
- After writing, verify: total page count = ${pageCount}. If not, adjust immediately.

Now generate the outline with EXACTLY ${pageCount} pages. Output ONLY the JSON array, no other text.
${langInstruction}`;

  const result = await llmInvoke(
    [{ role: 'user', content: outlinePrompt }],
    {
      model: runtimeConfig?.model || 'doubao-seed-2-0-pro-260215',
      temperature: 0.4,
      maxTokens: Number(process.env.PPT_OUTLINE_MAX_TOKENS || 900),
      signal: AbortSignal.timeout(Number(process.env.PPT_LLM_TIMEOUT_MS || 180_000)),
    },
    undefined,
    runtimeConfig,
  );

  const jsonMatch = result.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('大纲生成失败：无法解析 JSON');
  return JSON.parse(jsonMatch[0]);
}

// ============================================================
// Flatten outline (banana-slides flatten_outline)
// Merge parts into flat page list with part info attached
// ============================================================
function flattenOutline(outline: OutlineItem[]): OutlinePage[] {
  const pages: OutlinePage[] = [];
  for (const item of outline) {
    if ('part' in item && 'pages' in item) {
      for (const page of item.pages) {
        pages.push({ ...page, part: item.part });
      }
    } else {
      pages.push(item as OutlinePage);
    }
  }
  return pages;
}

// ============================================================
// Step 2: Generate descriptions (PARALLEL — like banana-slides ThreadPoolExecutor)
// Aligned with banana-slides get_page_description_prompt()
// Key features: structured output, detail levels, first-page rule, reference files
// ============================================================
async function genDesc(
  ideaPrompt: string,
  outline: OutlineItem[],
  papers: PPTRequest['papers'],
  detailLevel: string = 'default',
  language: string = 'zh',
  runtimeConfig?: Partial<RuntimeAIConfig>,
): Promise<string[]> {
  const pages = flattenOutline(outline);

  // Build reference files content (like banana-slides _format_reference_files_xml)
  let refFilesXml = '';
  if (papers && papers.length > 0) {
    refFilesXml = '<uploaded_files>\n';
    for (const p of papers) {
      const content = p.rawContent || p.content || '';
      refFilesXml += `  <file name="${p.title}">\n`;
      refFilesXml += `    <content>\n${content.slice(0, 6000)}\n    </content>\n`;
      refFilesXml += `  </file>\n`;
    }
    refFilesXml += '</uploaded_files>\n\n';
  }

  const detailSpec = DETAIL_LEVEL_SPECS[detailLevel] || DETAIL_LEVEL_SPECS.default;
  const pptLangInstr = PPT_LANG_INSTRUCTION[language] || '';
  const langInstr = language === 'en' ? 'Please output all in English.'
    : language === 'ja' ? 'すべて日本語で出力してください。'
    : language === 'auto' ? ''
    : '请使用全中文输出。';

  const descPromises = pages.map(async (pageOutline, i) => {
    const partInfo = pageOutline.part ? `\n当前所属章节：${pageOutline.part}` : '';
    const isFirstPage = i === 0;

    // Aligned with banana-slides get_page_description_prompt()
    const descPrompt = `${refFilesXml}我们正在为PPT的每一页生成内容描述。
用户的原始需求是：
${ideaPrompt}

我们已经有了完整的大纲：
${JSON.stringify(outline, null, 2)}
${partInfo}
现在请为第 ${i + 1} 页生成描述：
${JSON.stringify(pageOutline)}
${isFirstPage ? '**除非特殊要求，第一页的内容需要保持极简，只放标题副标题以及演讲人等（输出到标题后）, 不添加任何素材。**' : ''}

## 重要提示
生成的"页面文字"部分会直接渲染到PPT页面上，因此请务必不要包含任何额外的说明性文字或注释，也不要把用户的设计意图显式地放在页面文字中。

## 输出格式

--- 页面文字 ---

[此处使用markdown直接放置正文文字, 细致程度要求：${detailSpec}\n\n, 可包含latex公式、表格等内容, 不要重复添加]

--- 页面文字结束 ---

图片素材:
[如果文件中存在图片请积极添加； 否则忽略图片素材字段]

## 关于图片
如果参考文件中包含以 /files/ 开头的本地文件URL图片（例如 /files/mineru/xxx/image.png），请将这些图片以markdown格式输出。
${langInstr}`;

    const result = await llmInvoke(
      [{ role: 'user', content: descPrompt }],
      {
        model: runtimeConfig?.model || 'doubao-seed-2-0-pro-260215',
        temperature: 0.5,
        maxTokens: Number(process.env.PPT_DESC_MAX_TOKENS || 1200),
        signal: AbortSignal.timeout(Number(process.env.PPT_LLM_TIMEOUT_MS || 180_000)),
      },
      undefined,
      runtimeConfig,
    );
    console.log(`[PPT] ✓ Page ${i + 1}/${pages.length} description generated (${result.length} chars)`);
    return result;
  });

  // Parallel generation (like banana-slides ThreadPoolExecutor max_workers=5)
  const descResults = await Promise.all(descPromises);
  return descResults;
}

// ============================================================
// Parse structured description into title + text + material
// Handles banana-slides format: 页面标题/页面文字/图片素材
// ============================================================
function parseDesc(descText: string): SlideDesc {
  let pageTitle = '';
  let pageText = '';
  let imageMaterial = '';

  // Extract page title
  const titleMatch = descText.match(/页面标题[：:]\s*(.+?)(?:\n|$)/);
  if (titleMatch) pageTitle = titleMatch[1].trim();

  // Extract page text between markers (banana-slides format)
  const textMatch = descText.match(/---\s*页面文字\s*---\s*\n([\s\S]*?)\n---\s*页面文字结束\s*---/);
  if (textMatch) {
    pageText = textMatch[1].trim();
  } else {
    // Fallback: try loose matching
    const looseMatch = descText.match(/页面文字[：:]\s*\n([\s\S]*?)(?=图片素材|其他页面素材|$)/);
    if (looseMatch) pageText = looseMatch[1].trim();
  }

  // Extract image material
  const imgMatch = descText.match(/图片素材[：:]\s*\n([\s\S]*?)(?=$)/);
  if (imgMatch) imageMaterial = imgMatch[1].trim();

  // Final fallback: use first line as title, rest as content
  if (!pageTitle && !pageText) {
    const lines = descText.trim().split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      pageTitle = lines[0].replace(/^[#\-*\s]+/, '').trim();
      pageText = lines.slice(1).join('\n').trim();
    }
  }

  return { pageTitle, pageText, imageMaterial };
}

// ============================================================
// Step 3: Generate image prompts (aligned with banana-slides get_image_generation_prompt())
// Key: UI/UX designer persona, template consistency, cover emphasis, 4K, language
// ============================================================
function genPrompts(
  outline: OutlineItem[],
  descResults: string[],
  templateStyle?: string,
  language: string = 'zh',
  aspectRatio: string = '16:9',
): string[] {
  const pages = flattenOutline(outline);

  // Build outline text for context
  const outlineLines = pages.map((p, i) => {
    const pointsStr = p.points.join(', ');
    const partStr = p.part ? ` [${p.part}]` : '';
    return `${i + 1}. ${p.title}${partStr}: ${pointsStr}`;
  }).join('\n');

  const pptLangInstr = PPT_LANG_INSTRUCTION[language] || '';
  const styleDesc = templateStyle || '专业学术风格';

  return pages.map((page, i) => {
    const parsed = parseDesc(descResults[i]);
    const currentSection = page.part || page.title || '';
    const isFirstPage = i === 0;
    const pageDescForPrompt = descResults[i]; // full raw description for image model

    // Aligned with banana-slides get_image_generation_prompt()
    const prompt = `你是一位专家级UI UX演示设计师，专注于生成设计良好的PPT页面。
当前PPT页面的页面描述如下:
<page_description>
${pageDescForPrompt}
</page_description>

<design_guidelines>
- 要求文字清晰锐利, 画面为4K分辨率，${aspectRatio}比例。
- 配色和设计语言严格保持统一风格：${styleDesc}。
- 根据内容和要求自动设计最完美的构图，不重不漏地渲染"页面文字"段落中的文本。
- 如非必要，禁止出现 markdown 格式符号（如 # 和 * 等）。
- 只参考风格设计，禁止出现模板中的文字。
</design_guidelines>
${pptLangInstr}

${isFirstPage ? '**注意：当前页面为ppt的封面页，请你采用专业的封面设计美学技巧，务必凸显出页面标题，分清主次，确保一下就能抓住观众的注意力。**' : ''}

【整份PPT大纲】
${outlineLines}

【当前章节】${currentSection}
【第 ${i + 1}/${pages.length} 页】`;

    return prompt;
  });
}

// ============================================================
// Step 4: Generate images in parallel using 思坦AI
// Batched concurrency (like banana-slides ThreadPoolExecutor max_workers=8)
// ============================================================
async function genImagesParallel(
  prompts: string[],
  onProgress?: (completed: number, total: number) => void,
  aspectRatio: string = '16:9',
  refImageBase64?: string,
  runtimeConfig?: Partial<RuntimeAIConfig>,
): Promise<ImageGenerationResult[]> {
  const CONCURRENCY = 3; // 并发数（每日额度500张）
  const results: ImageGenerationResult[] = new Array(prompts.length).fill(null).map(() => ({ imageBase64: null }));
  let completed = 0;

  for (let i = 0; i < prompts.length; i += CONCURRENCY) {
    const batch = prompts.slice(i, i + CONCURRENCY);
    const imagePromises = batch.map(async (prompt, batchIdx) => {
      const globalIdx = i + batchIdx;
      try {
        console.log(`[PPT] 🎨 生成第 ${globalIdx + 1}/${prompts.length} 页图片...`);
        const base64Data = await generateImage(prompt, {
          aspectRatio,
          negativePrompt: '文字模糊、低质量、变形、水印、签名、多余装饰、排版混乱',
          referenceImageBase64: refImageBase64,
          runtimeConfig,
        });
        if (base64Data) {
          console.log(`[PPT] ✓ 第 ${globalIdx + 1}/${prompts.length} 页成功 (${(base64Data.length / 1024).toFixed(0)}KB)`);
        } else {
          console.log(`[PPT] ✗ 第 ${globalIdx + 1}/${prompts.length} 页失败`);
        }
        completed++;
        onProgress?.(completed, prompts.length);
        return { idx: globalIdx, result: { imageBase64: base64Data } };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error(`[PPT] ✗ 第 ${globalIdx + 1} 页异常:`, err);
        completed++;
        onProgress?.(completed, prompts.length);
        return { idx: globalIdx, result: { imageBase64: null, error } };
      }
    });

    const batchResults = await Promise.all(imagePromises);
    for (const { idx, result } of batchResults) {
      results[idx] = result;
    }
  }

  return results;
}

// ============================================================
// Step 5: Generate narration (演讲词) for each slide
// Uses outline + description to produce speaker notes
// ============================================================
async function genNarrations(
  pages: { title: string; points: string[]; part?: string }[],
  descriptions: { pageTitle: string; pageText: string; imageMaterial?: string }[],
  language: string = 'zh',
  runtimeConfig?: Partial<RuntimeAIConfig>,
): Promise<string[]> {
  const langInstruction = language === 'en'
    ? 'Write the narration in English.'
    : language === 'ja'
      ? '講演のナレーションを日本語で書いてください。'
      : '请用中文撰写演讲词。';

  const prompt = `你是一位经验丰富的学术会议演讲者，正在为一场重要的学术汇报准备逐页讲解稿。

请为以下PPT的每一页生成一段**详尽、专业、可直接朗读**的演讲词，要求：

## 内容要求
1. **每页300-500字**（不是200-350字），这是正式汇报的完整口述稿
2. **不要照读幻灯片文字**——你的任务是"展开讲"，而不是"念标题"
3. 对每个要点进行深度展开：
   - 解释"为什么"：这个要点为什么重要？背景是什么？
   - 解释"怎么做"：具体方法、数据来源、实验设计
   - 解释"意味着什么"：结果的意义、与领域的关联
4. 适当加入过渡语："接下来我们来看..."、"值得注意的是..."、"这与前面的发现形成了..."
5. 如果该页有数据/图表，要引导听众关注关键数据点
6. 开头要有吸引注意力的引入语，结尾要有承上启下的总结

## 语言风格
- 口语化但保持学术严谨性（像TED演讲或Nature论文oral presentation）
- 使用短句和停顿感（逗号分隔的短语）
- 避免过于书面化的长难句
- ${langInstruction}

## 输出格式
严格按以下JSON数组格式输出，不要有任何其他文字（包括markdown标记）：
["第1页演讲词内容", "第2页演讲词内容", ...]

## PPT内容

${pages.map((page, i) => {
    const desc = descriptions[i];
    return `### 第${i + 1}页：${page.title}
【幻灯片上的要点】${page.points.join('；') || '(无明确要点)'}
【页面详细描述】${desc?.pageText || '(无描述)'}`;
  }).join('\n\n')}
`;

  try {
    console.log(`[PPT] 🎤 开始生成${pages.length}页演讲词...`);
    const result = await llmInvoke([{ role: 'user', content: prompt }], {
      model: runtimeConfig?.model || 'doubao-seed-2-0-pro-260215',
      temperature: 0.7,
      maxTokens: Number(process.env.PPT_NARRATION_MAX_TOKENS || 1800),
      signal: AbortSignal.timeout(Number(process.env.PPT_LLM_TIMEOUT_MS || 180_000)),
    }, undefined, runtimeConfig);
    console.log(`[PPT] 🎤 LLM返回演讲词原始长度: ${result.length}字符`);

    // Parse JSON array from LLM response (robust extraction)
    let jsonMatch = result.match(/\[[\s\S]*?\](?=\s*$)/);
    if (!jsonMatch) jsonMatch = result.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const narrations: string[] = JSON.parse(jsonMatch[0]);
        // Validate and log each narration length
        narrations.forEach((n, i) => {
          console.log(`[PPT] 🎤 第${i + 1}页演讲词: ${n.length}字`);
        });
        while (narrations.length < pages.length) narrations.push('');
        return narrations.slice(0, pages.length);
      } catch (parseErr) {
        console.warn('[PPT] 🎤 JSON解析失败，尝试修复:', parseErr);
      }
    }

    // Fallback: try to extract quoted strings
    const quotedStrings = [...result.matchAll(/"([^"]{50,})"/g)].map(m => m[1]);
    if (quotedStrings.length >= pages.length) {
      console.log(`[PPT] 🎤 Fallback提取到${quotedStrings.length}段引用文本`);
      return quotedStrings.slice(0, pages.length);
    }

    // Last fallback: split by numbered markers or double newline
    const parts = result.split(/(?:第\d+页|---|\n{3,})/).filter(s => s.trim().length > 20);
    console.log(`[PPT] 🎤 最终fallback分割得到${parts.length}段`);
    return pages.map((_, i) => parts[i]?.trim() || '');
  } catch (e) {
    console.error('[PPT] 演讲词生成失败:', e);
    return pages.map(() => '');
  }
}

// ============================================================
// Main POST handler — SSE streaming progress (5 stages)
// ============================================================
export async function POST(request: NextRequest) {
  const body: PPTRequest = await request.json();
  const {
    papers, style, pageCount = 8, templateStyle,
    detailLevel = 'default', language = 'zh',
    aspectRatio = '16:9',
    referenceImageIndex = null,
    aiConfig,
    debugRetrievalOnly,
  } = body;
  const runtimeConfig = resolveServerRuntimeAIConfig(aiConfig);
  const scope = await resolveAccountNotebookScope(request, {
    notebookId: body.notebookId,
    loginMessage: '请先登录账号，再生成演示文稿。',
  });
  if (!scope.ok) return scope.response;

  if (!papers || papers.length === 0) {
    return NextResponse.json({ error: '请先选择要生成 PPT 的文献' }, { status: 400 });
  }

  const readiness = resolveStudioGenerationReadiness().imagePpt;
  if (!debugRetrievalOnly && !readiness.ready) {
    return NextResponse.json(studioGenerationUnavailablePayload(readiness), { status: 503 });
  }

  const grounded = await buildGroundedRetrievalContext(
    '生成学术演示文稿大纲、每页核心论点、关键证据、图表线索和可引用结论',
    papers,
    runtimeConfig,
    { topK: 12, ownerMemberId: scope.ownerMemberId, notebookId: scope.notebookId },
  );

  if (debugRetrievalOnly) {
    return NextResponse.json({
      success: true,
      citations: grounded.citations,
      retrieval: toRetrievalMetadata(grounded),
      promptContextLength: grounded.promptContext.length,
    });
  }

  const paperSummaries = papers.map(p => {
    const authors = Array.isArray(p.authors) ? p.authors.join(', ') : '';
    return `论文标题：${p.title || p.fileName || p.id || '未命名资料'}\n作者：${authors || '未解析作者'}\n年份：${p.year || ''}`;
  }).join('\n\n---\n\n');

  const evidencePapers = grounded.promptContext
    ? [{
      title: 'Grounded Evidence Outline',
      authors: ['Lingbi Retrieval'],
      year: new Date().getFullYear(),
      content: grounded.promptContext,
      rawContent: grounded.promptContext,
    }]
    : papers;

  // Build idea prompt from grounded evidence first; request content is only the fallback.
  const ideaPrompt = grounded.promptContext
    ? `${paperSummaries}\n\n【检索证据】\n${grounded.promptContext}`
    : papers.map(p => {
    const parts = [`论文标题：${p.title}`, `作者：${(p.authors || []).join(', ')}`, `年份：${p.year || ''}`];
    if (p.abstract) parts.push(`摘要：${p.abstract}`);
    if (p.rawContent) parts.push(`原文内容：${p.rawContent.slice(0, 8000)}`);
    else if (p.content) parts.push(`内容分析：${p.content}`);
    return parts.join('\n');
  }).join('\n\n---\n\n');

  // Get style description from preset or custom
  const styleDesc = getStyleDescription(style, templateStyle);

  // Load reference image if specified (from source-media assets)
  let refImageBase64: string | undefined;
  if (referenceImageIndex !== null && referenceImageIndex >= 0) {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const sourceDir = path.join(process.cwd(), 'public', 'assets', 'source-media');
      const files = fs.readdirSync(sourceDir).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).sort();
      if (files[referenceImageIndex]) {
        const imgBuf = fs.readFileSync(path.join(sourceDir, files[referenceImageIndex]));
        refImageBase64 = imgBuf.toString('base64');
        console.log(`[PPT] 📷 参考图已加载: ${files[referenceImageIndex]} (${(imgBuf.length / 1024).toFixed(0)}KB)`);
      }
    } catch (e) {
      console.warn('[PPT] 参考图加载失败:', e);
    }
  }

  console.log(`[PPT] ▶ 开始生成 | 风格:${style || 'default'} | 页数:${pageCount} | 细节:${detailLevel} | 语言:${language} | 比例:${aspectRatio} | 参考图:${referenceImageIndex ?? '无'}`);

  // SSE streaming
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        sendEvent({
          stage: 'evidence',
          status: 'done',
          message: '已准备可追溯证据链',
          citations: grounded.citations,
          retrieval: toRetrievalMetadata(grounded),
        });

        // ── Stage 1: Generate Outline ──
        sendEvent({ stage: 'outline', status: 'generating', message: '正在生成 PPT 大纲...' });
        const outline = await genOutline(ideaPrompt, language, pageCount, runtimeConfig);
        let pages = flattenOutline(outline);

        // Force page count alignment: LLM may not obey exact count
        if (pages.length > pageCount) {
          // Truncate excess pages, keep the first pageCount
          pages = pages.slice(0, pageCount);
        } else if (pages.length < pageCount && pages.length > 0) {
          // Supplement by duplicating the last page with variant titles
          const lastPage = pages[pages.length - 1];
          const supplementTitles = ['补充说明', '延伸讨论', '应用前景', '数据支撑', '案例分析', '技术细节', '方法论补充', '对比分析'];
          while (pages.length < pageCount) {
            const idx = pages.length - pages.length; // 0-based offset
            pages.push({
              title: supplementTitles[idx % supplementTitles.length],
              points: ['待补充内容'],
              part: lastPage.part,
            });
          }
        }

        sendEvent({
          stage: 'outline', status: 'done',
          message: `大纲生成完成，共 ${pages.length} 页`,
          pageCount: pages.length,
          outline: pages.map(p => ({ title: p.title, part: p.part })),
        });

        // ── Stage 2: Generate Descriptions (PARALLEL) ──
        sendEvent({ stage: 'description', status: 'generating', message: '正在并行生成每页内容描述...' });
        const descResults = await genDesc(ideaPrompt, outline, evidencePapers, detailLevel, language, runtimeConfig);
        const descriptions = descResults.map(d => parseDesc(d));
        sendEvent({ stage: 'description', status: 'done', message: `每页描述生成完成 (${descResults.reduce((s, d) => s + d.length, 0)} 字)` });

        // ── Stage 3: Build Image Prompts ──
        const prompts = genPrompts(outline, descResults, styleDesc, language, aspectRatio);

        // ── Stage 4: Generate Images (PARALLEL with progress) ──
        sendEvent({ stage: 'image', status: 'generating', message: '正在并行生成幻灯片图片...', imageTotal: prompts.length });
        const imageResults = await genImagesParallel(prompts, (completed, total) => {
          sendEvent({ stage: 'image', status: 'progress', message: `图片生成中... ${completed}/${total}`, imageCompleted: completed, imageTotal: total });
        }, aspectRatio, refImageBase64, runtimeConfig);
        const imageUrls = imageResults.map(result => result.imageBase64);

        const successCount = imageUrls.filter(u => u !== null).length;
        sendEvent({ stage: 'image', status: 'done', message: `图片生成完成 ${successCount}/${imageUrls.length}` });
        if (successCount !== imageUrls.length) {
          const firstError = imageResults.find(result => result.error)?.error;
          throw new Error(`图片生成失败：${successCount}/${imageUrls.length} 页成功。${firstError ? `首个错误：${firstError}` : '请检查账号绑定的图片模型服务。'}`);
        }

        // ── Stage 5: Generate Narrations (演讲词) ──
        sendEvent({ stage: 'narration', status: 'generating', message: '正在生成每页演讲词...' });
        const narrations = await genNarrations(pages, descriptions, language, runtimeConfig);
        sendEvent({ stage: 'narration', status: 'done', message: '演讲词生成完成' });

        // ── Build final slides (base64 → data URI + narration) ──
        const slides = pages.map((page, i) => ({
          title: descriptions[i]?.pageTitle || page.title || `幻灯片 ${i + 1}`,
          content: descriptions[i]?.pageText || page.points.join('\n'),
          imageUrl: imageUrls[i] ? `data:image/png;base64,${imageUrls[i]}` : null,
          narration: narrations[i] || '',
          part: page.part,
        }));

        sendEvent({
          stage: 'done',
          status: 'done',
          message: 'PPT 生成完成！',
          slides,
          citations: grounded.citations,
          retrieval: toRetrievalMetadata(grounded),
        });
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'PPT 生成失败';
        console.error('[PPT] Generation error:', message);
        sendEvent({ stage: 'error', status: 'error', message });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
