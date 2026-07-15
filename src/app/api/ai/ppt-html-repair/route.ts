import { NextRequest, NextResponse } from 'next/server';
import { resolveServerRuntimeAIConfig } from '@/lib/runtime-ai-config';
import type { RuntimeAIConfig } from '@/types';
import { getHtmlDeckStyle } from '@/lib/ppt/html-deck-style';
import { generateSlideHtml, type DeckOutlinePage } from '@/lib/ppt/html-deck-generation';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import {
  resolveStudioGenerationReadiness,
  studioGenerationUnavailablePayload,
} from '@/lib/studio-generation-readiness';

export const maxDuration = 300;

// ============================================================
// Single-slide repair / re-layout for the HTML deck mode.
// Two callers:
// 1. Automatic quality loop — the client measures rendered slides and
//    sends back overflow reports ("problem") for regeneration.
// 2. User-driven re-layout — the user asks for a change ("instruction").
// ============================================================

interface HtmlRepairRequest {
  currentHtml: string;
  problem?: string;
  instruction?: string;
  outline?: DeckOutlinePage;
  slideIndex?: number;
  slideTotal?: number;
  deckTitle?: string;
  styleId?: string;
  language?: 'zh' | 'en';
  aiConfig?: Partial<RuntimeAIConfig>;
  notebookId?: string;
}

export async function POST(request: NextRequest) {
  const body: HtmlRepairRequest = await request.json();
  const scope = await resolveAccountNotebookScope(request, {
    notebookId: body.notebookId,
    loginMessage: '请先登录账号,再修改幻灯片。',
    requireAuthenticatedPaperHost: true,
  });
  if (!scope.ok) return scope.response;

  const currentHtml = (body.currentHtml || '').trim();
  if (!currentHtml || currentHtml.length > 100_000) {
    return NextResponse.json({ error: '当前页面 HTML 缺失或过大' }, { status: 400 });
  }
  if (!body.problem?.trim() && !body.instruction?.trim()) {
    return NextResponse.json({ error: '缺少修复问题描述或修改要求' }, { status: 400 });
  }

  const readiness = resolveStudioGenerationReadiness().htmlPpt;
  if (!readiness.ready) {
    return NextResponse.json(studioGenerationUnavailablePayload(readiness), { status: 503 });
  }

  const style = getHtmlDeckStyle(body.styleId);
  const runtimeConfig = resolveServerRuntimeAIConfig(body.aiConfig);
  const page: DeckOutlinePage = body.outline || { title: '幻灯片', points: [] };

  try {
    console.log(`[PPT-HTML-Repair] ▶ 第 ${Number(body.slideIndex ?? 0) + 1} 页 | ${body.problem ? '自动修复' : '用户重排'}`);
    const html = await generateSlideHtml({
      page,
      index: Number(body.slideIndex ?? 0),
      total: Number(body.slideTotal ?? 1),
      deckTitle: body.deckTitle || '资料简报',
      styleContract: style.contract,
      evidence: '',
      language: body.language || 'zh',
      runtimeConfig,
      revision: {
        currentHtml,
        problem: body.problem?.trim() || undefined,
        instruction: body.instruction?.trim() || undefined,
      },
    });
    return NextResponse.json({ success: true, html });
  } catch (err) {
    const message = err instanceof Error ? err.message : '页面修复失败';
    console.error('[PPT-HTML-Repair] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
