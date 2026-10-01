import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { isProduction, storeFile, retrieveFileBuffer, downloadToTemp } from '@/lib/storage';
import { parseRuntimeAIConfigJson, resolveServerRuntimeAIConfig } from '@/lib/runtime-ai-config';
import { resolveInternalAppOrigin } from '@/lib/internal-origin';
import { ingestExtractedSource, updateSourceMinerUStatus } from '@/lib/ingestion-store';
import { classifyMinerUJobFailure, mineruJobErrorMessage, mineruJobOptionsFromEnv } from '@/lib/mineru-job';
import { accountAuthRequired, resolveAccountSessionFromRequest } from '@/lib/account-session';
import { normalizeNotebookId } from '@/lib/notebook-scope';

const SUPPORTED_TYPES = new Set([
  'pdf', 'doc', 'docx', 'txt', 'md',
  'jpg', 'jpeg', 'png', 'gif', 'webp',
  'csv', 'xlsx', 'ppt', 'pptx',
]);

const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_UPLOAD_FILES = 5;

function readPositiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function maxUploadBytes(): number {
  return readPositiveIntEnv('MAX_UPLOAD_BYTES', DEFAULT_MAX_UPLOAD_BYTES);
}

function maxUploadFiles(): number {
  return readPositiveIntEnv('MAX_UPLOAD_FILES', DEFAULT_MAX_UPLOAD_FILES);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}

function getFileExt(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

function isImageType(ext: string): boolean {
  return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
}

function shouldAnalyzeUploadWithAI(ext: string, extractedContent: string): boolean {
  if (isImageType(ext) || ext === 'pdf') return true;
  if (['txt', 'md', 'csv'].includes(ext)) return false;
  return extractedContent.trim().length < 1200;
}

// ─── 文档内容提取 ─────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// MinerU 后台提取（fire-and-forget，不阻塞上传响应）
async function triggerMinerUExtraction(paperId: string, fileKeyOrPath: string, fileName: string, internalOrigin: string): Promise<void> {
  if (!process.env.MINERU_API_TOKEN?.trim()) {
    await updateSourceMinerUStatus(paperId, 'not_configured');
    console.log(`[MinerU] Skipped background extraction for ${fileName}: MINERU_API_TOKEN is not configured`);
    return;
  }

  const options = mineruJobOptionsFromEnv();
  const maxAttempts = options.maxRetries + 1;
  let lastFailureMessage = 'MinerU job failed';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let timedOut = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs);

    try {
      await updateSourceMinerUStatus(paperId, 'running');
      console.log(`[MinerU] Triggering background extraction for ${fileName} (paperId: ${paperId}, attempt=${attempt}/${maxAttempts})`);
      const res = await fetch(`${internalOrigin}/api/mineru/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paperId, fileKeyOrPath, fileName }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text().catch(() => 'unknown');
        const failure = classifyMinerUJobFailure({
          status: res.status,
          message: `MinerU request failed (${res.status}): ${errText}`,
        });
        lastFailureMessage = mineruJobErrorMessage(failure, attempt);
        console.error(`[MinerU] ${lastFailureMessage}`);
        if (failure.retryable && attempt < maxAttempts) {
          await sleep(options.retryDelayMs);
          continue;
        }
        await updateSourceMinerUStatus(paperId, 'failed', { error: lastFailureMessage });
        return;
      }

      const data = await res.json();
      await updateSourceMinerUStatus(paperId, 'succeeded', {
        figureCount: typeof data.figureCount === 'number' ? data.figureCount : 0,
      });
      console.log(`[MinerU] Background extraction completed: ${data.figureCount || 0} figures extracted`);
      return;
    } catch (err) {
      clearTimeout(timeout);
      const failure = classifyMinerUJobFailure({
        message: err instanceof Error ? err.message : String(err),
        timedOut,
      });
      lastFailureMessage = mineruJobErrorMessage(failure, attempt);
      console.error(`[MinerU] ${lastFailureMessage}`);
      if (failure.retryable && attempt < maxAttempts) {
        await sleep(options.retryDelayMs);
        continue;
      }
      await updateSourceMinerUStatus(paperId, failure.category === 'timeout' ? 'failed' : 'error', { error: lastFailureMessage });
      return;
    }
  }

  await updateSourceMinerUStatus(paperId, 'failed', { error: lastFailureMessage });
}

async function extractPdfText(filePath: string): Promise<string> {
  try {
    // pdf-parse v1 会加载内部测试文件，在 Next.js 环境中找不到，设置环境变量跳过
    process.env.PDF_PARSER_DISABLE_TEST = '1';
    const pdfParse = (await import('pdf-parse-fixed')).default;
    const fs = await import('fs/promises');
    const dataBuffer = await fs.readFile(filePath);
    const result = await pdfParse(dataBuffer);
    return result.text || '';
  } catch (e) {
    console.error('[extractPdfText] Failed:', e instanceof Error ? e.message : 'unknown');
    return '';
  }
}

async function extractDocxText(filePath: string): Promise<string> {
  const mammoth = await import('mammoth');

  // 方式1: extractRawText 提取纯文本
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    if (result.value && result.value.trim().length > 0) {
      return result.value;
    }
  } catch (e) {
    console.error('[extractDocxText] extractRawText failed:', e instanceof Error ? e.message : 'unknown');
  }

  // 方式2: convertToHtml 再去标签（某些 DOCX extractRawText 为空但 HTML 有内容）
  try {
    const result = await mammoth.convertToHtml({ path: filePath });
    if (result.value && result.value.trim().length > 0) {
      // 简单去 HTML 标签
      return result.value.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }
  } catch (e) {
    console.error('[extractDocxText] convertToHtml failed:', e instanceof Error ? e.message : 'unknown');
  }

  // 方式3: 读取 ZIP 内的 word/document.xml 直接提取 <w:t> 文本
  try {
    const fs = await import('fs/promises');
    const buffer = await fs.readFile(filePath);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);
    const docXml = zip.file('word/document.xml');
    if (docXml) {
      const xmlContent = await docXml.async('string');
      // 提取 <w:t> 标签内容
      const textMatches = xmlContent.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
      if (textMatches && textMatches.length > 0) {
        return textMatches.map(m => m.replace(/<[^>]+>/g, '')).join('');
      }
    }
  } catch (e) {
    console.error('[extractDocxText] JSZip fallback failed:', e instanceof Error ? e.message : 'unknown');
  }

  return '';
}

async function extractXlsxText(filePath: string): Promise<string> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.readFile(filePath);
  const sheets: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (csv.trim()) {
      sheets.push(`=== 工作表: ${sheetName} ===\n${csv}`);
    }
  }
  return sheets.join('\n\n');
}

async function extractPptxText(filePath: string): Promise<string> {
  // PPTX is a ZIP containing XML; use xlsx library's sister approach
  // For robustness, we use the JSZip-based approach via mammoth-like parsing
  // Since there's no lightweight pptx parser, we'll try reading as ZIP
  try {
    const fs = await import('fs/promises');
    const buffer = await fs.readFile(filePath);
    // Use dynamic import for JSZip (already available via Next.js dependency chain)
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);
    const slides: string[] = [];
    let slideIndex = 1;

    while (true) {
      const slideFile = zip.file(`ppt/slides/slide${slideIndex}.xml`);
      if (!slideFile) break;

      const xmlContent = await slideFile.async('string');
      // Extract text from <a:t> tags in the XML
      const textMatches = xmlContent.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];
      const texts = textMatches
        .map((m: string) => m.replace(/<a:t[^>]*>/, '').replace(/<\/a:t>/, ''))
        .filter((t: string) => t.trim());

      if (texts.length > 0) {
        slides.push(`=== 幻灯片 ${slideIndex} ===\n${texts.join('\n')}`);
      }
      slideIndex++;
    }

    return slides.join('\n\n') || '';
  } catch {
    return '';
  }
}

async function readFileContent(filePath: string, ext: string): Promise<string> {
  try {
    const fs = await import('fs/promises');

    // 图片：返回 base64
    if (isImageType(ext)) {
      const buffer = await fs.readFile(filePath);
      return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${buffer.toString('base64')}`;
    }

    // 纯文本文件
    const textTypes = ['txt', 'md', 'csv'];
    if (textTypes.includes(ext)) {
      return await fs.readFile(filePath, 'utf-8');
    }

    // PDF
    if (ext === 'pdf') {
      const text = await extractPdfText(filePath);
      if (text.trim()) return text;
      // pdf-parse 提取不到文本（可能是扫描件或 pdf-parse 失败）
      // 返回空字符串，upload 路由会调用视觉模型 OCR 兜底
      return '';
    }

    // DOCX
    if (ext === 'docx') {
      return await extractDocxText(filePath);
    }

    // DOC (旧格式，mammoth 不支持，尝试作为文本读取)
    if (ext === 'doc') {
      try {
        return await fs.readFile(filePath, 'utf-8');
      } catch {
        return '[DOC旧格式文件，建议转换为DOCX后上传]';
      }
    }

    // XLSX
    if (ext === 'xlsx') {
      return await extractXlsxText(filePath);
    }

    // PPTX
    if (ext === 'pptx') {
      return await extractPptxText(filePath);
    }

    // PPT (旧格式)
    if (ext === 'ppt') {
      return '[PPT旧格式文件，建议转换为PPTX后上传]';
    }

    return '';
  } catch (err) {
    console.error(`[ReadFile] Failed to extract ${ext}:`, err instanceof Error ? err.message : 'unknown');
    return '';
  }
}

// ─── 上传处理 ─────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    let ownerMemberId: string | undefined;
    try {
      const accountSession = await resolveAccountSessionFromRequest(request);
      if (accountAuthRequired() && !accountSession) {
        return NextResponse.json({ error: '请先登录账号，再上传资料。' }, { status: 401 });
      }
      ownerMemberId = accountSession?.member.id;
    } catch {
      return NextResponse.json({ error: '账号登录已过期，请重新登录。' }, { status: 401 });
    }

    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    const notebookId = normalizeNotebookId(formData.get('notebookId'));
    const rawAIConfig = formData.get('aiConfig');
    const requestAIConfig = typeof rawAIConfig === 'string' ? parseRuntimeAIConfigJson(rawAIConfig) : undefined;
    const aiConfig = resolveServerRuntimeAIConfig(requestAIConfig);

    if (!files || files.length === 0) {
      return NextResponse.json({ error: '没有上传文件' }, { status: 400 });
    }

    const maxFiles = maxUploadFiles();
    if (files.length > maxFiles) {
      return NextResponse.json({
        error: `单次最多上传 ${maxFiles} 个文件`,
        maxFiles,
      }, { status: 413 });
    }

    const results = [];
    const isProd = isProduction();
    const maxBytes = maxUploadBytes();
    const internalOrigin = resolveInternalAppOrigin();

    for (const file of files) {
      const ext = getFileExt(file.name);

      if (!SUPPORTED_TYPES.has(ext)) {
        results.push({
          fileName: file.name,
          error: `不支持的文件格式: ${ext || '无扩展名'}`,
        });
        continue;
      }

      if (file.size > maxBytes) {
        results.push({
          fileName: file.name,
          error: `文件过大：${formatBytes(file.size)}，单文件上限为 ${formatBytes(maxBytes)}`,
          maxFileSizeBytes: maxBytes,
        });
        continue;
      }

      try {
        const buffer = Buffer.from(await file.arrayBuffer());

        // 保存文件（开发环境→本地，生产环境→S3）
        const { key: fileKey, localPath } = await storeFile(
          buffer,
          file.name,
          file.type || undefined,
        );

        // 获取本地文件路径用于内容提取
        // 开发环境：localPath 直接可用
        // 生产环境：下载到 /tmp 临时目录
        let localFilePath: string;
        if (localPath) {
          localFilePath = localPath;
        } else {
          // 生产环境：下载到 /tmp 用于内容提取
          const tempName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          localFilePath = await downloadToTemp(fileKey, tempName);
        }

        const baseName = file.name.replace(/\.[^.]+$/, '');

        // 提取文件内容
        let fileContent = await readFileContent(localFilePath, ext);

        // 所有 PDF 都走视觉模型识别（不管 pdf-parse 是否提取到文本）
        // 原因：pdf-parse 只能提取纯文本，无法理解图表/公式/图片
        // 视觉模型能同时理解文字内容和图表信息
        const pdfTextFromParser = fileContent;
        if (ext === 'pdf') {
          try {
            const pdfBase64 = buffer.toString('base64');
            const ocrRes = await fetch(`${internalOrigin}/api/ai/analyze-pdf`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pdfBase64, fileName: file.name, aiConfig }),
            });
            if (ocrRes.ok) {
              const ocrData = await ocrRes.json();
              if (ocrData.success && ocrData.content) {
                // 合并：如果 pdf-parse 也有文本，拼接两者；否则只用视觉模型结果
                if (pdfTextFromParser.trim().length > 50) {
                  fileContent = `【PDF文本提取】\n${pdfTextFromParser.slice(0, 15000)}\n\n【视觉模型识别（含图表理解）】\n${ocrData.content}`;
                } else {
                  fileContent = ocrData.content;
                }
              }
            }
          } catch (ocrErr) {
            console.error('[Upload] PDF vision analysis failed:', ocrErr instanceof Error ? ocrErr.message : 'unknown');
            // 视觉模型失败时，至少保留 pdf-parse 的文本
            if (pdfTextFromParser.trim().length > 0) {
              fileContent = pdfTextFromParser;
            }
          }
        }

        // DOCX 兜底：文本提取为空时，将首页转为图片用视觉模型识别
        if (ext === 'docx' && fileContent.trim().length < 20) {
          try {
            // 尝试用 LibreOffice 将 DOCX 转 PDF，再用视觉模型识别
            const { execSync } = await import('child_process');
            const tmpPdf = `/tmp/${Date.now()}-docx.pdf`;
            try {
              execSync(`libreoffice --headless --convert-to pdf --outdir /tmp "${localFilePath}"`, { timeout: 30000 });
              const fs = await import('fs/promises');
              const pdfBuffer = await fs.readFile(tmpPdf);
              const pdfBase64 = pdfBuffer.toString('base64');
              const ocrRes = await fetch(`${internalOrigin}/api/ai/analyze-pdf`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pdfBase64, fileName: file.name, aiConfig }),
              });
              if (ocrRes.ok) {
                const ocrData = await ocrRes.json();
                if (ocrData.success && ocrData.content) {
                  fileContent = ocrData.content;
                }
              }
              // 清理临时文件
              const fs2 = await import('fs/promises');
              await fs2.unlink(tmpPdf).catch(() => {});
            } catch (libreErr) {
              console.error('[Upload] DOCX→PDF conversion failed:', libreErr instanceof Error ? libreErr.message : 'unknown');
            }
          } catch (docxFallbackErr) {
            console.error('[Upload] DOCX OCR fallback failed:', docxFallbackErr instanceof Error ? docxFallbackErr.message : 'unknown');
          }
        }

        // 普通文本先走快路径入库；需要视觉/结构理解的资料再调用 AI 分析。
        let analysis = null;
        const needsAIAnalysis = shouldAnalyzeUploadWithAI(ext, fileContent);
        if (needsAIAnalysis) try {
          // 对文本类文件，发送提取的文本内容（截断到 15000 字符以适应 LLM 上下文）
          // 对图片文件，发送 base64
          const isImage = isImageType(ext);
          const textContent = isImage ? '' : fileContent.slice(0, 15000);

          const analyzeRes = await fetch(`${internalOrigin}/api/ai/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: file.name,
              fileType: ext,
              fileContent: textContent,
              imageBase64: isImage ? fileContent : undefined,
              aiConfig,
            }),
          });

          if (analyzeRes.ok) {
            const analyzeData = await analyzeRes.json();
            if (analyzeData.success && analyzeData.analysis) {
              analysis = analyzeData.analysis;
            }
          }
        } catch (analyzeErr) {
          console.error('[Upload] AI analysis failed:', analyzeErr instanceof Error ? analyzeErr.message : 'unknown');
        }

        const title = analysis?.title || baseName;
        const authors = Array.isArray(analysis?.authors) ? analysis.authors : ['未解析作者'];
        const year = typeof analysis?.year === 'number' ? analysis.year : new Date().getFullYear();
        const keywords = Array.isArray(analysis?.keywords) ? analysis.keywords : ['原始数据'];
        const abstract = typeof analysis?.abstract === 'string' ? analysis.abstract : `该文件包含了关于${title}的原始资料与数据记录。`;
        const content = typeof analysis?.content === 'string' ? analysis.content : abstract;
        const rawContent = isImageType(ext) ? '' : fileContent.slice(0, 50000);
        const shortName = `${authors[0]}. ${year}`;
        const journal = typeof analysis?.journal === 'string' ? analysis.journal : '';
        const doi = typeof analysis?.doi === 'string' ? analysis.doi : '';
        const paperId = `paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const sourceRecord = await ingestExtractedSource({
          id: paperId,
          ownerMemberId,
          notebookId,
          fileName: file.name,
          fileType: ext,
          fileSize: file.size,
          fileKey,
          fileUrl: fileKey,
          title,
          authors,
          year,
          abstract,
          content,
          rawContent,
          shortName,
        }, { aiConfig });

        console.log(`[Upload] File: ${file.name}, ext: ${ext}, content length: ${content.length}, rawContent length: ${rawContent.length}, analysis: ${analysis ? 'OK' : needsAIAnalysis ? 'NULL' : 'SKIPPED'}, env: ${isProd ? 'PROD' : 'DEV'}`);

        // For PDF files, trigger MinerU extraction in the background
        let mineruStatus: 'pending' | 'running' | 'done' | 'failed' | undefined;
        const mineruConfigured = Boolean(process.env.MINERU_API_TOKEN?.trim());
        if (ext === 'pdf') {
          mineruStatus = mineruConfigured ? 'pending' : undefined;
          await updateSourceMinerUStatus(paperId, mineruConfigured ? 'pending' : 'not_configured');
          // Fire-and-forget: trigger MinerU extraction asynchronously
          triggerMinerUExtraction(paperId, fileKey, file.name, internalOrigin).catch((mineruErr) => {
            console.error('[Upload] MinerU background extraction failed:', mineruErr instanceof Error ? mineruErr.message : 'unknown');
          });
        }

        results.push({
          id: paperId,
          notebookId,
          fileName: file.name,
          savedFileName: isProd ? undefined : path.basename(fileKey),
          fileKey: isProd ? fileKey : undefined,
          fileUrl: fileKey,
          fileType: ext,
          fileSize: file.size,
          title,
          authors,
          year,
          keywords,
          abstract,
          content,
          rawContent,
          shortName,
          journal,
          doi,
          uploadTime: new Date().toISOString(),
          mineruStatus,
          ingestionStatus: sourceRecord.status,
          ingestionChunkCount: sourceRecord.chunkCount,
          ingestionStages: ext === 'pdf'
            ? sourceRecord.stages.map(stage => stage.name === 'mineru' ? { ...stage, status: mineruConfigured ? 'pending' : 'failed' } : stage)
            : sourceRecord.stages,
          mineru: ext === 'pdf'
            ? { status: mineruConfigured ? 'pending' : 'not_configured', updatedAt: new Date().toISOString() }
            : sourceRecord.mineru,
          vectorIndex: {
            status: sourceRecord.vectorIndex.status,
            dimension: sourceRecord.vectorIndex.dimension,
            count: sourceRecord.vectorIndex.count,
          },
        });
      } catch (fileErr) {
        results.push({
          fileName: file.name,
          error: `上传失败: ${fileErr instanceof Error ? fileErr.message : '未知错误'}`,
        });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '上传处理失败';
    console.error('[Upload API Error]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
