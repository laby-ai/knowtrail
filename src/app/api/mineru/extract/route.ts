import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readFile } from 'fs/promises';
import path from 'path';
import { claimSourceMinerUSubmission, getIngestionSource, updateSourceMinerUStatus } from '@/lib/ingestion-store';
import {
  downloadToTemp,
  isUsingObjectStorage,
  listStoredFileKeys,
  resolveFileUrl,
  storeMinerUFigure,
  storeMinerUMetadata,
  retrieveFileBuffer,
} from '@/lib/storage';

// ── MinerU API Configuration ──
const MINERU_API_BASE = 'https://mineru.net';
const MINERU_API_TOKEN = process.env.MINERU_API_TOKEN || '';

// ── Types ──
interface MinerUFigureResult {
  label: string;
  caption: string;
  pageIdx: number;
  bbox: number[];
  localPath: string;
  imageUrl: string;
  width?: number;
  height?: number;
}

interface ExtractResult {
  figures: MinerUFigureResult[];
  markdownContent: string;
}

// ── Step 1: Upload PDF to MinerU via batch file-urls API ──
async function uploadToMinerU(filePath: string, fileName: string): Promise<{ batchId: string; uploadUrl: string }> {
  const url = `${MINERU_API_BASE}/api/v4/file-urls/batch`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${MINERU_API_TOKEN}`,
  };

  const body = {
    files: [{ name: fileName, data_id: `paper-${Date.now()}` }],
    model_version: 'vlm', // VLM model for better figure understanding
    enable_formula: true,
    enable_table: true,
    language: 'ch',
  };

  console.log(`[MinerU] Uploading ${fileName} to MinerU...`);
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MinerU upload failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`MinerU API error: ${data.msg || 'Unknown error'}`);
  }

  const batchId: string = data.data.batch_id;
  const uploadUrl: string = data.data.file_urls[0];

  // Upload the actual file to the presigned URL
  console.log(`[MinerU] Uploading file content to presigned URL...`);
  const fileBuffer = await readFile(filePath);
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    body: fileBuffer,
  });

  if (!uploadRes.ok) {
    throw new Error(`File upload to MinerU storage failed (${uploadRes.status})`);
  }

  console.log(`[MinerU] File uploaded. Batch ID: ${batchId}`);
  return { batchId, uploadUrl };
}

// ── Step 2: Poll for extraction result ──
async function pollExtractionResult(batchId: string, maxAttempts: number = 120): Promise<string> {
  const url = `${MINERU_API_BASE}/api/v4/extract-results/batch/${batchId}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${MINERU_API_TOKEN}`,
  };

  console.log(`[MinerU] Polling for results (batch: ${batchId})...`);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // Poll every 5s

    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn(`[MinerU] Poll attempt ${attempt + 1} failed: ${res.status}`);
      continue;
    }

    const data = await res.json();
    if (data.code !== 0) {
      console.warn(`[MinerU] Poll API error: ${data.msg}`);
      continue;
    }

    const results = data.data?.extract_result;
    if (!Array.isArray(results) || results.length === 0) {
      continue;
    }

    const result = results[0];
    const state: string = result.state;

    if (state === 'done') {
      const zipUrl: string = result.full_zip_url;
      console.log(`[MinerU] Extraction complete! ZIP URL: ${zipUrl.slice(0, 80)}...`);
      return zipUrl;
    }

    if (state === 'failed') {
      throw new Error(`MinerU extraction failed: ${result.err_msg || 'Unknown error'}`);
    }

    // Still pending/running/converting
    if (attempt % 6 === 0) {
      const progress = result.extract_progress;
      console.log(`[MinerU] State: ${state}, Progress: ${progress?.extracted_pages || '?'}/${progress?.total_pages || '?'}`);
    }
  }

  throw new Error('MinerU extraction timed out');
}

// ── Step 3: Download and parse ZIP ──
// Strategy: Only process images referenced in content_list.json (type='image' with valid img_path)
// Filter out small icons/decorations by bbox size, and extract figure labels from nearby text
async function downloadAndParseZip(zipUrl: string, paperId: string): Promise<ExtractResult> {
  console.log(`[MinerU] Downloading result ZIP...`);
  const res = await fetch(zipUrl);
  if (!res.ok) throw new Error(`Failed to download ZIP (${res.status})`);

  const zipBuffer = Buffer.from(await res.arrayBuffer());
  const JSZipModule = await import('jszip');
  const JSZip = JSZipModule.default || JSZipModule;
  const zip = await JSZip.loadAsync(zipBuffer);

  const usingObjectStorage = isUsingObjectStorage();
  // local 存储才创建本地目录
  const figuresDir = path.join(process.cwd(), 'public', 'mineru-figures', paperId);
  if (!usingObjectStorage) {
    await mkdir(figuresDir, { recursive: true });
  }

  // Parse content_list.json (v1 - has img_path references)
  let contentList: Array<Record<string, unknown>> = [];
  const contentListFile = Object.keys(zip.files).find(
    f => f.endsWith('_content_list.json') && !f.endsWith('_v2.json')
  );
  if (contentListFile) {
    const contentListStr = await zip.file(contentListFile)!.async('string');
    contentList = JSON.parse(contentListStr);
    console.log(`[MinerU] Content list: ${contentList.length} items`);
  }

  // Parse markdown
  let markdownContent = '';
  const mdFile = Object.keys(zip.files).find(f => f.endsWith('full.md'));
  if (mdFile) {
    markdownContent = await zip.file(mdFile)!.async('string');
    console.log(`[MinerU] Markdown: ${markdownContent.length} chars`);
  }

  // ── Build figure-caption mapping from content_list ──
  const textByPage = new Map<number, Array<{ text: string; idx: number }>>();
  for (let i = 0; i < contentList.length; i++) {
    const item = contentList[i];
    if (item.type === 'text' || item.type === 'title') {
      const pageIdx = typeof item.page_idx === 'number' ? item.page_idx : -1;
      const text = typeof item.text === 'string' ? item.text : '';
      if (pageIdx >= 0 && text) {
        if (!textByPage.has(pageIdx)) textByPage.set(pageIdx, []);
        textByPage.get(pageIdx)!.push({ text, idx: i });
      }
    }
  }

  const figCaptionRe = /(?:Fig\.?\s*\d+|Figure\s*\d+|图\s*\d+)/i;

  const imageEntries: Array<{
    imgPathInZip: string;
    pageIdx: number;
    bbox: number[];
    caption: string;
    figureLabel: string;
  }> = [];

  for (let i = 0; i < contentList.length; i++) {
    const item = contentList[i];
    if (item.type !== 'image') continue;
    const imgPath = String(item.img_path || '');
    if (!imgPath) continue;

    const pageIdx = typeof item.page_idx === 'number' ? item.page_idx : -1;
    const bbox = Array.isArray(item.bbox) ? (item.bbox as number[]) : [];

    // Filter: only keep images with reasonable bbox size
    const bboxW = bbox.length >= 4 ? bbox[2] - bbox[0] : 0;
    const bboxH = bbox.length >= 4 ? bbox[3] - bbox[1] : 0;
    if (bboxW < 120 || bboxH < 80) {
      console.log(`[MinerU] Skipping small image on page ${pageIdx}: bbox=${bbox} (${bboxW}x${bboxH})`);
      continue;
    }

    // Try to find figure caption from nearby text on the same page
    // Best strategy: look for text that starts with "Fig." or "Figure" (likely a caption)
    // rather than text that merely mentions "Fig." in passing (likely a reference)
    let caption = '';
    let figureLabel = '';
    const pageTexts = textByPage.get(pageIdx) || [];

    // First pass: look for text that STARTS with a figure reference (most likely a caption)
    const captionStartRe = /^(?:Fig\.?\s*\d+|Figure\s*\d+|图\s*\d+)/i;
    for (const pt of pageTexts) {
      if (captionStartRe.test(pt.text.trim())) {
        const match = pt.text.match(figCaptionRe);
        if (match) {
          figureLabel = match[0];
          caption = pt.text.length > 200 ? pt.text.slice(0, 200) + '...' : pt.text;
          break;
        }
      }
    }

    // Second pass: if no caption found, look for text mentioning a figure after this image
    if (!figureLabel) {
      for (const pt of pageTexts) {
        if (pt.idx > i) {
          const match = pt.text.match(figCaptionRe);
          if (match) {
            figureLabel = match[0];
            caption = pt.text.length > 200 ? pt.text.slice(0, 200) + '...' : pt.text;
            break;
          }
        }
      }
    }

    const rawCaptions = Array.isArray(item.caption) ? item.caption : [];
    const rawCaptionText = rawCaptions.join(' ');
    if (rawCaptionText && !caption) {
      caption = rawCaptionText;
      const labelMatch = rawCaptionText.match(figCaptionRe);
      if (labelMatch) figureLabel = labelMatch[0];
    }

    imageEntries.push({ imgPathInZip: imgPath, pageIdx, bbox, caption, figureLabel });
  }

  console.log(`[MinerU] Found ${imageEntries.length} valid figure entries from content_list`);

  // ── Save images and build figure results ──
  const figures: MinerUFigureResult[] = [];
  let figureCounter = 0;

  for (const entry of imageEntries) {
    const imgBasename = path.basename(entry.imgPathInZip);
    const matchingFile = Object.keys(zip.files).find(
      f => !zip.files[f].dir && (f === entry.imgPathInZip || f.endsWith('/' + imgBasename) || f.endsWith('\\' + imgBasename))
    );
    if (!matchingFile) {
      console.warn(`[MinerU] Image file not found in ZIP: ${entry.imgPathInZip}`);
      continue;
    }

    const imgData = await zip.file(matchingFile)!.async('nodebuffer');
    const ext = path.extname(imgBasename).toLowerCase() || '.jpg';
    const savedName = `fig-${++figureCounter}${ext}`;

    let figureLocalPath: string;
    let figureImageUrl: string;

    if (usingObjectStorage) {
      // 对象存储：上传到 S3-compatible provider
      const contentType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      const result = await storeMinerUFigure(imgData, paperId, savedName, contentType);
      figureLocalPath = result.key;
      figureImageUrl = result.accessUrl;
    } else {
      // local 存储：保存到本地
      await writeFile(path.join(figuresDir, savedName), imgData);
      figureLocalPath = `mineru-figures/${paperId}/${savedName}`;
      figureImageUrl = `/mineru-figures/${paperId}/${savedName}`;
    }

    figures.push({
      label: entry.figureLabel || `Fig.${figureCounter}`,
      caption: entry.caption,
      pageIdx: entry.pageIdx,
      bbox: entry.bbox,
      localPath: figureLocalPath,
      imageUrl: figureImageUrl,
    });
  }

  // ── Fallback: if no figures from content_list, try ALL images in /images/ folder ──
  if (figures.length === 0) {
    console.log('[MinerU] No figures from content_list, falling back to all /images/ files...');
    const allImageFiles = Object.keys(zip.files).filter(
      f => !zip.files[f].dir && (f.includes('/images/') || f.includes('\\images\\'))
    );
    for (const imgPath of allImageFiles) {
      const imgData = await zip.file(imgPath)!.async('nodebuffer');
      if (imgData.length < 10240) continue;
      const ext = path.extname(imgPath).toLowerCase() || '.jpg';
      const savedName = `fig-${++figureCounter}${ext}`;

      let figureLocalPath: string;
      let figureImageUrl: string;

      if (usingObjectStorage) {
        const contentType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        const result = await storeMinerUFigure(imgData, paperId, savedName, contentType);
        figureLocalPath = result.key;
        figureImageUrl = result.accessUrl;
      } else {
        await writeFile(path.join(figuresDir, savedName), imgData);
        figureLocalPath = `mineru-figures/${paperId}/${savedName}`;
        figureImageUrl = `/mineru-figures/${paperId}/${savedName}`;
      }

      figures.push({
        label: `Fig.${figureCounter}`,
        caption: '',
        pageIdx: -1,
        bbox: [],
        localPath: figureLocalPath,
        imageUrl: figureImageUrl,
      });
    }
  }

  console.log(`[MinerU] Extracted ${figures.length} figures, saved to ${figuresDir}`);

  // Save metadata
  if (figures.length > 0) {
    await storeMinerUMetadata(JSON.stringify(figures, null, 2), paperId);
  }

  return { figures, markdownContent };
}


// ============================================================
// Route Handler
// ============================================================
export async function POST(request: NextRequest) {
  let sourceId: string | undefined;
  try {
    const body = await request.json();
    const { paperId, filePath, fileKeyOrPath, fileName } = body as {
      paperId: string;
      filePath?: string;
      fileKeyOrPath?: string;
      fileName: string;
    };

    const effectiveFilePath = fileKeyOrPath || filePath;

    if (!paperId || !effectiveFilePath || !fileName) {
      return NextResponse.json({ error: '缺少必要参数 (paperId, filePath/fileKeyOrPath, fileName)' }, { status: 400 });
    }

    if (!MINERU_API_TOKEN) {
      return NextResponse.json({ error: 'MinerU API Token 未配置' }, { status: 500 });
    }

    const source = await getIngestionSource(paperId);
    if (!source) return NextResponse.json({ error: '来源已不存在，未启动解析。' }, { status: 404 });
    if ((source.storageKey || source.fileUrl) !== effectiveFilePath || source.fileName !== fileName) {
      return NextResponse.json({ error: '文件与原来源不一致，未启动解析。' }, { status: 409 });
    }
    sourceId = source.id;

    console.log(`[MinerU] Starting extraction for paper: ${paperId}, file: ${fileName}, storage=${isUsingObjectStorage() ? 'object-storage' : 'local'}`);

    // Step 1: Upload to MinerU
    let batchId = source.mineru?.batchId;
    if (!batchId) {
      // 确保文件在本地可访问（对象存储需要下载到 /tmp）
      let localFilePath: string;
      if (isUsingObjectStorage() && !effectiveFilePath.startsWith('/')) {
        // 对象存储 key：下载到临时目录
        const tempName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${fileName}`;
        localFilePath = await downloadToTemp(effectiveFilePath, tempName);
      } else if (effectiveFilePath.startsWith('/')) {
        // 本地路径（开发环境）
        localFilePath = path.join(process.cwd(), 'public', effectiveFilePath.replace(/^\//, ''));
      } else {
        // 已经是绝对路径
        localFilePath = effectiveFilePath;
      }
      const claim = await claimSourceMinerUSubmission(paperId, effectiveFilePath, fileName);
      if (!claim.source) return NextResponse.json({ error: '来源已不存在，未启动解析。' }, { status: 404 });
      if ((claim.source.storageKey || claim.source.fileUrl) !== effectiveFilePath || claim.source.fileName !== fileName) {
        return NextResponse.json({ error: '文件与原来源不一致，未启动解析。' }, { status: 409 });
      }
      batchId = claim.source.mineru?.batchId;
      if (!batchId && !claim.claimed) {
        return NextResponse.json({ error: '原解析任务已提交或尚未确认，未重复提交。' }, { status: 409 });
      }
      if (!batchId) batchId = (await uploadToMinerU(localFilePath, fileName)).batchId;
      try {
        const recorded = await updateSourceMinerUStatus(paperId, 'running', { batchId });
        if (!recorded) return NextResponse.json({ error: '来源已不存在，已停止保存解析结果。' }, { status: 404 });
      } catch {
        await updateSourceMinerUStatus(paperId, 'failed', { error: '解析任务记录保存失败，暂未重试。' }).catch(() => undefined);
        return NextResponse.json({ error: '解析任务已提交，但任务记录保存失败，暂未重试。' }, { status: 409 });
      }
    }

    // Step 2: Poll for result
    const zipUrl = await pollExtractionResult(batchId);

    // Step 3: Download and parse
    const result = await downloadAndParseZip(zipUrl, paperId);
    await updateSourceMinerUStatus(paperId, 'succeeded', { figureCount: result.figures.length });

    return NextResponse.json({
      success: true,
      paperId,
      figures: result.figures,
      markdownContent: result.markdownContent.slice(0, 5000), // Truncate for response
      figureCount: result.figures.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[MinerU] Extraction error:', msg);
    if (sourceId) await updateSourceMinerUStatus(sourceId, 'failed', { error: err, apiKey: MINERU_API_TOKEN }).catch(() => undefined);
    return NextResponse.json({ error: `MinerU 提取失败: ${msg}` }, { status: 500 });
  }
}

// ── GET: Check extraction status / retrieve cached results ──
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const paperId = searchParams.get('paperId');

  if (!paperId) {
    return NextResponse.json({ error: '缺少 paperId 参数' }, { status: 400 });
  }

  if (isUsingObjectStorage()) {
    // 对象存储：通过统一 storage provider 读取元数据和签名 URL
    try {
      // 尝试列出该 paperId 的图表文件
      const keys = await listStoredFileKeys(`mineru-figures/${paperId}/`, 100);
      const imageKeys = keys.filter(k => /\.(png|jpg|jpeg|gif|webp)$/i.test(k));

      // 尝试读取元数据
      let figures: MinerUFigureResult[] = [];
      const metaKey = keys.find(k => k.endsWith('_metadata.json'));
      if (metaKey) {
        const metaBuffer = await retrieveFileBuffer(metaKey);
        figures = JSON.parse(metaBuffer.toString('utf-8'));
      } else {
        figures = imageKeys.map((k, i) => ({
          label: `Fig.${i + 1}`,
          caption: '',
          pageIdx: -1,
          bbox: [],
          imageUrl: k,
          localPath: k,
        }));
      }

      // 为图片生成签名 URL
      const figuresWithUrls = await Promise.all(
        figures.map(async (fig) => {
          const key = fig.localPath || fig.imageUrl;
          if (key && !key.startsWith('http')) {
            const signedUrl = await resolveFileUrl(key);
            return { ...fig, imageUrl: signedUrl };
          }
          return fig;
        })
      );

      return NextResponse.json({
        paperId,
        status: imageKeys.length > 0 ? 'done' : 'pending',
        figureCount: imageKeys.length,
        figures: figuresWithUrls,
      });
    } catch {
      return NextResponse.json({
        paperId,
        status: 'pending',
        figureCount: 0,
        figures: [],
      });
    }
  }

  // 开发环境：从本地读取
  const figuresDir = path.join(process.cwd(), 'public', 'mineru-figures', paperId);
  try {
    const fs = await import('fs/promises');
    const files = await fs.readdir(figuresDir);
    const imageFiles = files.filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f));

    // Try to load metadata
    let figures: MinerUFigureResult[] = [];
    try {
      const metaStr = await readFile(path.join(figuresDir, '_metadata.json'), 'utf-8');
      figures = JSON.parse(metaStr);
    } catch {
      // No metadata, construct basic figure list
      figures = imageFiles.map((f, i) => ({
        label: `Fig.${i + 1}`,
        caption: '',
        pageIdx: -1,
        bbox: [],
        imageUrl: `/mineru-figures/${paperId}/${f}`,
        localPath: `mineru-figures/${paperId}/${f}`,
      }));
    }

    return NextResponse.json({
      paperId,
      status: imageFiles.length > 0 ? 'done' : 'pending',
      figureCount: imageFiles.length,
      figures,
    });
  } catch {
    return NextResponse.json({
      paperId,
      status: 'pending',
      figureCount: 0,
      figures: [],
    });
  }
}
