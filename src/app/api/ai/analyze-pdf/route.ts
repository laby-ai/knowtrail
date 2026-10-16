import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { readFile, unlink, mkdir } from 'fs/promises';
import path from 'path';
import { llmStream } from '@/lib/ai-service';
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
  try {
    const { pdfBase64, fileName, maxPages, aiConfig } = await request.json() as {
      pdfBase64?: string;
      fileName?: string;
      maxPages?: number;
      aiConfig?: Partial<RuntimeAIConfig>;
    };

    if (!pdfBase64) {
      return NextResponse.json({ error: '缺少 PDF 数据' }, { status: 400 });
    }

    if (!hasRuntimeAIProvider(aiConfig) && !hasServerFallbackModel()) {
      return NextResponse.json({
        success: false,
        content: '',
        pagesAnalyzed: 0,
        skipped: true,
        reason: '未配置视觉模型，已跳过 PDF 视觉识别。',
      });
    }

    const pagesToProcess = Math.min(maxPages || MAX_PAGES, MAX_PAGES);

    // 将 base64 PDF 保存为临时文件
    const tmpDir = '/tmp/pdf-ocr';
    await mkdir(tmpDir, { recursive: true });
    const pdfId = `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const pdfPath = path.join(tmpDir, `${pdfId}.pdf`);
    const imgPrefix = path.join(tmpDir, pdfId);

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    const { writeFile } = await import('fs/promises');
    await writeFile(pdfPath, pdfBuffer);

    // 用 pdftoppm 把 PDF 渲染为 PNG 图片
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(
          'pdftoppm',
          ['-png', '-r', String(DPI), '-l', String(pagesToProcess), pdfPath, imgPrefix],
          { timeout: 60000 },
          (err) => (err ? reject(err) : resolve()),
        );
      });
    } catch (pdftoppmErr) {
      const errMsg = pdftoppmErr instanceof Error ? pdftoppmErr.message : String(pdftoppmErr);
      console.error(`[Analyze PDF] pdftoppm failed for ${fileName}: ${errMsg}`);
      throw new Error(`PDF渲染失败: ${errMsg}`);
    }

    // 读取生成的图片
    const imageBase64List: string[] = [];
    for (let i = 1; i <= pagesToProcess; i++) {
      const pageFile = path.join(tmpDir, `${pdfId}-${i}.png`);
      try {
        const imgBuf = await readFile(pageFile);
        imageBase64List.push(`data:image/png;base64,${imgBuf.toString('base64')}`);
        await unlink(pageFile).catch(() => {});
      } catch {
        break;
      }
    }

    // 清理 PDF 临时文件
    await unlink(pdfPath).catch(() => {});

    if (imageBase64List.length === 0) {
      return NextResponse.json({ error: 'PDF 渲染失败，无法生成图片' }, { status: 500 });
    }

    // 用视觉模型识别每一页（并发处理）
    const pageContents: string[] = [];
    const total = imageBase64List.length;

    // 分批并发处理
    for (let batch = 0; batch < total; batch += CONCURRENT_VISION) {
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
              }, undefined, aiConfig);

              for await (const chunk of stream) {
                if (chunk) pageText += chunk;
              }
            } catch (streamErr: unknown) {
              const errMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
              console.error(`[Analyze PDF] Vision model failed for page ${pageNum}: ${errMsg}`);
              pageText = `[第${pageNum}页识别失败: ${errMsg}]`;
            }
            return `--- 第${pageNum}页 ---\n${pageText}`;
          })(),
        );
      }

      const batchResults = await Promise.all(batchPromises);
      pageContents.push(...batchResults);
    }

    return NextResponse.json({
      success: true,
      content: pageContents.join('\n\n'),
      pagesAnalyzed: imageBase64List.length,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error || 'PDF识别失败');
    const stack = error instanceof Error ? error.stack : '';
    console.error('[Analyze PDF Error]', msg, stack);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
