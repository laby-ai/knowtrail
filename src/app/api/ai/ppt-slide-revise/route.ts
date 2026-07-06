import { NextRequest, NextResponse } from 'next/server';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';
import { generateSlideImage, resolveImageRuntimeConfig } from '@/lib/ppt/image-generation';
import type { RuntimeAIConfig } from '@/types';

export const maxDuration = 300;

// ============================================================
// Per-slide image revision (Cowart-style annotation iteration)
// The client sends the current slide image — optionally with the
// user's hand-drawn annotations composited on top — plus a text
// instruction. The image model regenerates a clean slide that
// applies the requested changes while keeping the original
// composition and style.
// ============================================================

interface SlideReviseRequest {
  imageBase64: string;          // current slide (annotated or clean), no data: prefix
  instruction: string;          // user's revision instruction
  hasAnnotations?: boolean;     // true if imageBase64 contains drawn markup
  slideTitle?: string;
  styleDescription?: string;    // deck-level style contract for consistency
  aspectRatio?: string;
  aiConfig?: Partial<RuntimeAIConfig>;
  notebookId?: string;
}

export async function POST(request: NextRequest) {
  const body: SlideReviseRequest = await request.json();
  const scope = await resolveAccountNotebookScope(request, {
    notebookId: body.notebookId,
    loginMessage: '请先登录账号,再修改幻灯片。',
  });
  if (!scope.ok) return scope.response;

  const imageBase64 = (body.imageBase64 || '').replace(/^data:image\/\w+;base64,/, '');
  const instruction = (body.instruction || '').trim();
  if (!imageBase64) {
    return NextResponse.json({ error: '缺少幻灯片图片' }, { status: 400 });
  }
  if (!instruction && !body.hasAnnotations) {
    return NextResponse.json({ error: '请填写修改要求或在图上标注' }, { status: 400 });
  }
  if (imageBase64.length > 24_000_000) {
    return NextResponse.json({ error: '图片过大,无法处理' }, { status: 413 });
  }

  const annotationGuidance = body.hasAnnotations
    ? `参考图上包含用户手绘的红色标注(圈选、箭头、文字批注),这些标注表达了修改意图:
- 按标注位置与批注文字执行修改。
- 生成的新图必须是干净的成品页,绝对不能保留任何标注痕迹(红圈、箭头、手写字)。`
    : '参考图是当前幻灯片成品,请在保持整体构图的基础上执行修改。';

  const prompt = `你是一位专家级演示设计师。请基于参考图重新生成这一页幻灯片。

【修改要求】${instruction || '按图上标注执行修改'}
${body.slideTitle ? `【页面标题】${body.slideTitle}` : ''}
${annotationGuidance}

【一致性要求】
- 除修改点外,保持原图的版式结构、配色、字体风格与信息内容不变。
- 文字清晰锐利,4K 分辨率,${body.aspectRatio || '16:9'} 比例。
${body.styleDescription ? `- 整体视觉风格继续遵守:${body.styleDescription.slice(0, 800)}` : ''}
- 禁止出现 markdown 符号、水印、多余装饰。`;

  try {
    console.log(`[PPT-Revise] ▶ 修改幻灯片 | 标注:${body.hasAnnotations ? '有' : '无'} | 指令:${instruction.slice(0, 60)}`);
    const revised = await generateSlideImage(prompt, {
      aspectRatio: body.aspectRatio || '16:9',
      negativePrompt: '标注痕迹、红圈、箭头、手写批注、文字模糊、低质量、变形、水印',
      referenceImageBase64: imageBase64,
      runtimeConfig: resolveImageRuntimeConfig(body.aiConfig),
    });
    if (!revised) {
      return NextResponse.json({ error: '图片模型未返回结果,请稍后重试' }, { status: 502 });
    }
    return NextResponse.json({ success: true, imageUrl: `data:image/png;base64,${revised}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : '幻灯片修改失败';
    console.error('[PPT-Revise] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
