import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { readFile, readdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { llmStream } from '@/lib/ai-service';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { hasRuntimeAIProvider, resolveServerRuntimeAIConfig } from '@/lib/runtime-ai-config';
import type { RuntimeAIConfig } from '@/types';

const MAX_PAGES = 20;
const DPI = 200;
const CONCURRENT_VISION = 3;

function hasServerFallbackModel(): boolean {
  return hasRuntimeAIProvider(resolveServerRuntimeAIConfig());
}

/**
 * 将 PDF 页面渲染为图片后，用视觉模型识别内容（文字 + 图表）
 * POST { pdfBase64: string, fileName?: string, maxPages?: number }
 */
export async function POST(request: NextRequest) {
  let tmpDir: string | undefined;
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  try {
    const { pdfBase64, fileName, maxPages, notebookId, aiConfig } = await request.json() as {
      pdfBase64?: string;
      fileName?: string;
      maxPages?: number;
      notebookId?: string;
      aiConfig?: Partial<RuntimeAIConfig>;
    };

    const scope = await resolveAccountNotebookScope(request, {
      notebookId,
      loginMessage: '请先登录国科大科教平台，再识别 PDF。',
      requireAuthenticatedPaperHost: true,
    });
    if (!scope.ok) return scope.response;
    if (typeof pdfBase64 !== 'string' || !pdfBase64) {
      return json({ error: '缺少 PDF 数据' }, 400);
    }
    if (maxPages !== undefined && (!Number.isInteger(maxPages) || maxPages < 1)) return json({ error: '识别页数必须为正整数。' }, 400);
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (pdfBuffer.length > 25 * 1024 * 1024) return json({ error: 'PDF 超过 25MB 上传上限。' }, 413);

    if (!hasRuntimeAIProvider(aiConfig) && !hasServerFallbackModel()) {
      return json({
        success: false,
        content: '',
        pagesAnalyzed: 0,
        skipped: true,
        reason: '未配置视觉模型，已跳过 PDF 视觉识别。',
      });
    }

    const pagesToProcess = Math.min(maxPages ?? MAX_PAGES, MAX_PAGES);

    // 将 base64 PDF 保存为临时文件
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-pdf-ocr-'));
    const pdfPath = path.join(tmpDir, 'source.pdf');
    const imgPrefix = path.join(tmpDir, 'page');
    await writeFile(pdfPath, pdfBuffer);
    const info = await new Promise<string>((resolve, reject) => {
      execFile('pdfinfo', [pdfPath], { timeout: 10000, env: { ...process.env, LC_ALL: 'C' }, signal: request.signal }, (err, stdout) => err ? reject(err) : resolve(stdout));
    });
    const totalPages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
    if (!Number.isInteger(totalPages) || totalPages < 1) return json({ success: false, error: '无法确认 PDF 页数，请检查文件。' }, 422);
    if (totalPages > pagesToProcess) return json({ success: false, totalPages, pageLimit: pagesToProcess, pagesAnalyzed: 0, content: '', error: `PDF 共 ${totalPages} 页，视觉识别单次最多 ${pagesToProcess} 页。扫描件请按不超过 ${pagesToProcess} 页拆分后上传；可提取的原生文本仍可保留。` }, 422);

    // 用 pdftoppm 把 PDF 渲染为 PNG 图片
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(
          'pdftoppm',
          ['-png', '-r', String(DPI), '-l', String(pagesToProcess), pdfPath, imgPrefix],
          { timeout: 60000, signal: request.signal },
          (err) => (err ? reject(err) : resolve()),
        );
      });
    } catch (pdftoppmErr) {
      console.error('[Analyze PDF] Page rendering failed');
      throw pdftoppmErr;
    }

    // 读取生成的图片
    const imageBase64List: string[] = [];
    const pageFiles = new Map((await readdir(tmpDir)).flatMap(name => {
      const match = /^page-(\d+)\.png$/.exec(name);
      return match ? [[Number(match[1]), name] as const] : [];
    }));
    for (let i = 1; i <= totalPages; i++) {
      const pageFile = pageFiles.get(i);
      if (!pageFile) throw new Error('Missing rendered page');
      const imgBuf = await readFile(path.join(tmpDir, pageFile));
      imageBase64List.push(`data:image/png;base64,${imgBuf.toString('base64')}`);
    }

    // 用视觉模型识别每一页（并发处理）
    const pageContents: string[] = [];
    const failedPages: number[] = [];
    const total = imageBase64List.length;

    // 分批并发处理
    for (let batch = 0; batch < total; batch += CONCURRENT_VISION) {
      if (request.signal.aborted) throw new Error('Request aborted');
      const batchPromises = [];
      for (let j = batch; j < Math.min(batch + CONCURRENT_VISION, total); j++) {
        const idx = j;
        const pageNum = idx + 1;
        const isFirst = idx === 0;

        const pagePrompt = isFirst
          ? `你是一位学术论文阅读专家。请仔细分析这张 PDF 页面，这是文件"${fileName || '未知'}"的第${pageNum}页。

请完成以下任务：
1. **文字提取**：完整提取页面中所有文字内容，包括标题、作者、摘要、正文段落、图注、表注、脚注等
2. **图表识别**：如果页面包含图表（Figure/Table），请：
   - 标注图表编号（如 Fig.1, Table 1）
   - 描述图表类型（折线图/柱状图/散点图/流程图/显微镜图/表格等）
   - 提取图表中的关键数据（坐标轴标签、数值范围、显著趋势）
   - 概述图表说明的研究发现
3. **公式识别**：如果包含数学公式，请用 LaTeX 语法转录

输出格式：
直接输出提取和分析的内容，使用 Markdown 格式。图表部分用"## 图表："开头。`
          : `你是一位学术论文阅读专家。请仔细分析这张 PDF 页面（第${pageNum}页）。

请完成以下任务：
1. 完整提取所有文字内容
2. 如果包含图表，描述图表类型、关键数据和研究发现
3. 如果包含公式，用 LaTeX 语法转录

直接输出内容，使用 Markdown 格式。图表部分用"## 图表："开头。`;

        const messages = [
          {
            role: 'user' as const,
            content: [
              { type: 'text' as const, text: pagePrompt },
              { type: 'image_url' as const, image_url: { url: imageBase64List[idx] } },
            ],
          },
        ];

        batchPromises.push(
          (async () => {
            let pageText = '';
            try {
              const stream = llmStream(messages, {
                model: 'doubao-seed-1-6-vision-250815',
                temperature: 0.2,
                thinking: 'disabled',
                vision: true,
                signal: request.signal,
              }, undefined, resolveServerRuntimeAIConfig(aiConfig));

              for await (const chunk of stream) {
                if (request.signal.aborted) throw new Error('Request aborted');
                if (chunk) pageText += chunk;
              }
              if (!pageText.trim()) throw new Error('Empty page transcription');
            } catch {
              console.error(`[Analyze PDF] Vision model failed for page ${pageNum}`);
              failedPages.push(pageNum);
              pageText = '';
            }
            return `--- 第${pageNum}页 ---\n${pageText}`;
          })(),
        );
      }

      const batchResults = await Promise.all(batchPromises);
      pageContents.push(...batchResults);
    }

    if (failedPages.length) return json({ success: false, content: '', totalPages, pagesAnalyzed: totalPages - failedPages.length, failedPages: failedPages.sort((a, b) => a - b), error: `第 ${failedPages.sort((a, b) => a - b).join('、')} 页识别失败，未保存不完整的视觉正文。请稍后重新上传。` }, 502);
    if (request.signal.aborted) throw new Error('Request aborted');
    return json({
      success: true,
      content: pageContents.join('\n\n'),
      totalPages,
      pagesAnalyzed: totalPages,
      complete: true,
    });
  } catch (error: unknown) {
    console.error('[Analyze PDF Error]', error instanceof Error ? error.name : 'UnknownError');
    return json({ success: false, content: '', error: request.signal.aborted ? 'PDF 识别已停止，未保存不完整正文。' : 'PDF 渲染或识别失败，请检查文件后重试。' }, request.signal.aborted ? 499 : 500);
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  }
}
