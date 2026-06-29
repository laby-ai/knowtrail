import { NextRequest, NextResponse } from 'next/server';
import { buildGroundedRetrievalContext, toRetrievalMetadata } from '@/lib/grounded-retrieval';
import { formatPptOutlineDraftForPrompt, sanitizePptOutlineDraft } from '@/lib/ppt/outline-draft';
import { readMinerUFiguresFromDisk, runMinerUExtraction, type MinerUFigureInput } from '@/lib/ppt/mineru-figures';
import { resolveServerRuntimeAIConfig } from '@/lib/runtime-ai-config';
import { downloadToTemp, isUsingObjectStorage } from '@/lib/storage';
import type { RuntimeAIConfig } from '@/types';
import path from 'path';
import { buildAcademicPptx } from '@/lib/ppt/academic-renderer';
import type { PaperInput, PptOptions, SlideSpec } from '@/lib/ppt/academic-types';
import { genAcademicOutline } from '@/lib/ppt/academic-planner';
import { llmCallLogs, llmInvokeObserved, markFallback, markJsonParsed, resetLlmCallLogs } from '@/lib/ppt/academic-observability';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';

// ── Grounded outline helpers ──
function buildGroundedOutlinePapers(papers: PaperInput[], promptContext: string): PaperInput[] {
  if (!promptContext) return papers;
  const first = papers[0];
  if (!first) return papers;
  const authors = Array.isArray(first.authors) ? first.authors.join(', ') : '';
  const meta = papers.map((p, i) => {
    const pAuthors = Array.isArray(p.authors) ? p.authors.join(', ') : '';
    return `[${i + 1}] ${p.title || p.fileName || p.id || '未命名资料'}
sourceId: ${p.id || ''}
fileName: ${p.fileName || ''}
authors: ${pAuthors}
year: ${p.year || ''}`;
  }).join('\n\n');

  return [{
    ...first,
    title: first.title || first.fileName || 'Grounded Evidence Outline',
    authors: first.authors?.length ? first.authors : (authors ? [authors] : ['Lingbi Retrieval']),
    year: first.year || new Date().getFullYear(),
    abstract: first.abstract || '基于持久化 source/chunk 检索生成的学术报告 PPT 证据大纲。',
    content: `【资料元信息】\n${meta}\n\n【检索证据】\n${promptContext}`,
    rawContent: `【资料元信息】\n${meta}\n\n【检索证据】\n${promptContext}`,
  }];
}

// ============================================================
// Speaker Notes Generator (ArcDeck Phase 8 optional)
// Generates conversational speaker notes for each slide
// Based on ArcDeck's speaker_script.yaml prompt
// ============================================================
async function generateSpeakerNotes(
  papers: PaperInput[],
  slides: SlideSpec[],
  runtimeConfig?: Partial<RuntimeAIConfig>,
): Promise<string[]> {
  const paperAbstract = papers.map(p =>
    `Title: ${p.title}\nAbstract: ${(p.abstract || p.content || '').slice(0, 500)}`
  ).join('\n---\n');

  const slidePlan = slides.map((s, i) =>
    `[Slide ${i + 1}] ${s.type}: ${s.title}\n  Points: ${(s.bullets || []).join(' | ')}\n  Figure: ${s.figureLabel || 'N/A'}`
  ).join('\n');

  const audience = 'researchers'; // Could be parameterized later

  const prompt = `You are a Speech-Generation agent for academic conference talks.
Generate a natural, spoken script for every slide in the presentation.

Instructions:
1. For each slide, write one spoken paragraph (the "script") that a presenter would say while showing that slide.
2. Each script paragraph should be:
   - 3 to 6 sentences long
   - Conversational and suitable for a conference talk (clear, engaging, not reading bullet points verbatim)
   - Focused: cover what the slide shows and why it matters
   - Factual: do not invent claims beyond what the paper provides
3. Target audience: ${audience}
4. Language: Chinese (中文)

Paper:
${paperAbstract}

Slide Plan:
${slidePlan}

Output strictly as a JSON array of strings, one per slide, in the same order:
["slide 1 script...", "slide 2 script...", ...]

Do NOT wrap in markdown code fences. Output ONLY the JSON array.`;

  const { raw, log: _snLog } = await llmInvokeObserved('generateSpeakerNotes', [{ role: 'user', content: prompt }], {
    model: 'doubao-seed-2-0-pro-260215',
    timeoutMs: 60000,
    maxTokens: 1800,
    runtimeConfig,
  });

  try {
    const cleaned = raw.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      markJsonParsed('generateSpeakerNotes', true);
      return parsed.map((s: unknown) => String(s));
    }
    markJsonParsed('generateSpeakerNotes', false);
  } catch {
    markJsonParsed('generateSpeakerNotes', false);
    // Fallback: try to extract strings from the raw response
    const lines = raw.split('\n').filter(l => l.trim().startsWith('"'));
    if (lines.length >= slides.length * 0.5) {
      return lines.map(l => l.trim().replace(/^"|"$/g, '').replace(/",?$/, ''));
    }
  }

  // Ultimate fallback: generate simple notes per slide
  markFallback('generateSpeakerNotes', 'JSON parse failed, using title+bullets fallback');
  return slides.map((s, i) =>
    `第${i + 1}页：${s.title}。${(s.bullets || []).slice(0, 2).join('。')}。`
  );
}

export async function POST(request: NextRequest) {
  // ── Clear LLM observability logs for this request ──
  resetLlmCallLogs();

  try {
    const body = await request.json();
    const { papers, institution, closingStyle, presenterName, advisorName, duration, audience, speakerNotes, aiConfig, debugRetrievalOnly } = body as {
      papers: PaperInput[];
      institution?: string;
      closingStyle?: string;
      presenterName?: string;
      advisorName?: string;
      duration?: number;
      audience?: string;
      speakerNotes?: boolean;
      aiConfig?: Partial<RuntimeAIConfig>;
      debugRetrievalOnly?: boolean;
      outlineDraft?: unknown;
      notebookId?: string;
    };
    const outlineDraft = sanitizePptOutlineDraft(body.outlineDraft);
    const outlineDraftPrompt = formatPptOutlineDraftForPrompt(outlineDraft);
    const scope = await resolveAccountNotebookScope(request, {
      notebookId: body.notebookId,
      loginMessage: '请先登录账号，再生成结构化演示文稿。',
    });
    if (!scope.ok) return scope.response;

    if (!papers || papers.length === 0) {
      return NextResponse.json({ error: '请先选择文献' }, { status: 400 });
    }

    const runtimeConfig = resolveServerRuntimeAIConfig(aiConfig);
    const grounded = await buildGroundedRetrievalContext(
      '为学术报告 PPT 解析论证结构、研究背景、科学问题、方法、结果、讨论、结论和可引用证据',
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
        outlineDraft: {
          applied: outlineDraft.length > 0,
          count: outlineDraft.length,
          items: outlineDraft,
        },
      });
    }

    // ── Enrich papers with MinerU figures ──
    // Strategy: 1) Use provided figures 2) Read from disk 3) Trigger MinerU extraction if PDF
    console.log('[PPT-V2] Enriching papers with MinerU figures...');
    const enrichedPapers = await Promise.all(papers.map(async (p) => {
      // Already has figures
      if (p.mineruFigures && p.mineruFigures.length > 0) {
        console.log(`  Paper "${p.shortName || p.title}": already has ${p.mineruFigures.length} figures`);
        return p;
      }

      const paperId = p.id || '';
      if (!paperId) return p;

      // Try reading from disk
      const diskFigures = await readMinerUFiguresFromDisk(paperId);
      if (diskFigures.length > 0) {
        console.log(`  Paper "${p.shortName || p.title}": loaded ${diskFigures.length} figures from disk`);
        return { ...p, mineruFigures: diskFigures, mineruStatus: 'done' };
      }

      // Try triggering MinerU extraction if it's a PDF
      if (p.fileType === 'pdf' && p.fileUrl) {
        // 解析文件路径：local 用本地路径，对象存储下载到 /tmp
        let pdfFullPath: string;
        if (isUsingObjectStorage() && p.fileKey) {
          pdfFullPath = await downloadToTemp(p.fileKey, `${paperId}.pdf`);
        } else {
          pdfFullPath = path.join(process.cwd(), 'public', p.fileUrl.replace(/^\//, ''));
        }
        const pdfFileName = p.fileName || path.basename(p.fileUrl);
        console.log(`  Paper "${p.shortName || p.title}": triggering MinerU extraction for ${pdfFileName}...`);
        const extractedFigures = await runMinerUExtraction(paperId, pdfFullPath, pdfFileName);
        if (extractedFigures.length > 0) {
          console.log(`  Paper "${p.shortName || p.title}": extracted ${extractedFigures.length} figures via MinerU`);
          return { ...p, mineruFigures: extractedFigures, mineruStatus: 'done' };
        }
      }

      console.log(`  Paper "${p.shortName || p.title}": no MinerU figures available`);
      return p;
    }));

    console.log(`[PPT-V2] Generating academic PPTX from ${enrichedPapers.length} paper(s), institution=${institution || 'generic'}, closing=${closingStyle || 'blue'}, duration=${duration || 20}min, audience=${audience || 'researchers'}, speakerNotes=${speakerNotes || false}, outlineDraft=${outlineDraft.length}`);

    // Log MinerU figure availability
    enrichedPapers.forEach((p, i) => {
      const figCount = p.mineruFigures?.length || 0;
      console.log(`  Paper ${i + 1}: ${figCount} MinerU figures available`);
    });

    // Step 1: Generate academic outline via ArcDeck-Enhanced pipeline
    console.log('[PPT-V2] Step 1/4: Running ArcDeck-Enhanced pipeline...');
    const allMineruFigures = enrichedPapers.flatMap(p => p.mineruFigures || []);
    console.log(`[PPT-V2] allMineruFigures count: ${allMineruFigures.length}`);
    const outlinePapers = buildGroundedOutlinePapers(enrichedPapers, grounded.promptContext);
    console.log(`[PPT-V2] Grounded retrieval mode=${grounded.retrievalMode}, citations=${grounded.citations.length}, promptContext=${grounded.promptContext.length} chars`);
    const outline = await genAcademicOutline(outlinePapers, {
      institution: (institution as PptOptions['institution']) || 'generic',
      closingStyle: (closingStyle as PptOptions['closingStyle']) || 'blue',
      presenterName,
      advisorName,
      mineruFigures: allMineruFigures,
      duration: duration || 20,
      audience: (audience as PptOptions['audience']) || 'researchers',
      speakerNotes: speakerNotes || false,
      runtimeConfig,
      outlineDraft,
      outlineDraftPrompt,
    });
    console.log(`[PPT-V2] ✓ Outline: ${outline.length} slides generated`);
    outline.forEach((s, i) => {
      const commitment = s.commitmentCheck ? ` [${s.commitmentCheck}]` : '';
      console.log(`  [${i + 1}/${outline.length}] ${s.type}: ${s.title}${commitment}`);
    });

    // Step 2: Build PPTX with pptxgenjs
    console.log('[PPT-V2] Step 2/3: Building PPTX with pptxgenjs...');
    const buffer = await buildAcademicPptx(enrichedPapers, outline, {
      institution: (institution as PptOptions['institution']) || 'generic',
      closingStyle: (closingStyle as PptOptions['closingStyle']) || 'blue',
      presenterName,
      advisorName,
      duration: duration || 20,
      audience: (audience as PptOptions['audience']) || 'researchers',
      speakerNotes: speakerNotes || false,
      runtimeConfig,
    }, allMineruFigures, generateSpeakerNotes);

    // Step 3: Return as downloadable file
    const fileName = `academic-report-${Date.now()}.pptx`;
    console.log(`[PPT-V2] Step 3/3: Done! ${fileName} (${(buffer.length / 1024).toFixed(1)} KB)`);

    // ── LLM Observability Summary ──
    const fallbackStages = llmCallLogs.filter(l => l.fallbackTriggered).map(l => l.stage);
    const failedStages = llmCallLogs.filter(l => !l.success).map(l => l.stage);
    const llmSummary = {
      totalCalls: llmCallLogs.length,
      succeeded: llmCallLogs.filter(l => l.success).length,
      failed: failedStages.length,
      fallbacks: fallbackStages.length,
      failedStages,
      fallbackStages,
      outlineDraftApplied: outlineDraft.length > 0,
      outlineDraftCount: outlineDraft.length,
      details: llmCallLogs.map(l => ({
        stage: l.stage,
        model: l.model,
        durationMs: l.durationMs,
        success: l.success,
        timedOut: l.timedOut,
        jsonParsedOk: l.jsonParsedOk,
        fallbackTriggered: l.fallbackTriggered,
        fallbackReason: l.fallbackReason.slice(0, 100),
        rawPreview: l.rawPreview.slice(0, 120),
        errorPreview: l.errorPreview.slice(0, 80),
      })),
    };
    console.log(`[PPT-V2] LLM Observability: calls=${llmCallLogs.length} failed=[${failedStages}] fallback=[${fallbackStages}]`);

    const allowDegradedOutput = process.env.PPT_V2_ALLOW_DEGRADED_OUTPUT === 'true';
    if (!allowDegradedOutput && fallbackStages.length > 0) {
      return NextResponse.json({
        error: 'PPT-v2 生成出现关键阶段降级，已阻止返回低质量 PPT。请重试或调整模型/超时配置。',
        quality: 'failed',
        degraded: true,
        fallbackStages,
        failedStages,
        observability: llmSummary,
      }, {
        status: 502,
        headers: {
          'X-LLM-Observability': encodeURIComponent(JSON.stringify(llmSummary)),
        },
      });
    }

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'X-LLM-Observability': encodeURIComponent(JSON.stringify(llmSummary)),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[PPT-V2] Error:', msg);
    return NextResponse.json({ error: `PPT生成失败: ${msg}` }, { status: 500 });
  }
}
