import { NextRequest, NextResponse } from 'next/server';
import { llmInvoke } from '@/lib/ai-service';
import { hasRuntimeAIProvider, resolveServerRuntimeAIConfig } from '@/lib/runtime-ai-config';
import type { RuntimeAIConfig } from '@/types';
import { resolveAccountNotebookScope } from '@/lib/account-request-scope';

const isImageType = (ext: string) => ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);

function hasServerFallbackModel(): boolean {
  return hasRuntimeAIProvider(resolveServerRuntimeAIConfig());
}

function fallbackAnalysis(fileName: string, fileContent: string, abstract = 'AI分析暂时不可用，请稍后重试') {
  return {
    title: fileName.replace(/\.[^.]+$/, '') || '未解析文档',
    authors: [],
    year: null,
    keywords: ['原始数据'],
    abstract,
    content: fileContent ? fileContent.slice(0, 2000) : abstract,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { fileContent, fileName, fileType, imageBase64, aiConfig, notebookId } = await request.json() as {
      fileContent?: string;
      fileName?: string;
      fileType?: string;
      imageBase64?: string;
      aiConfig?: Partial<RuntimeAIConfig>;
      notebookId?: string;
    };
    const scope = await resolveAccountNotebookScope(request, {
      notebookId,
      loginMessage: '请先登录国科大科教平台，再分析资料。',
      requireAuthenticatedPaperHost: true,
    });
    if (!scope.ok) return scope.response;

    if (!fileContent && !fileName && !imageBase64) {
      return NextResponse.json({ error: '缺少文件内容' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
    }

    const isImage = isImageType(fileType || '');
    if (isImage && !imageBase64) {
      return NextResponse.json({ success: false, error: '缺少图片内容。' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
    }

    const response = isImage && imageBase64
      ? await analyzeImage(imageBase64, fileName || 'image', aiConfig)
      : await analyzeText(fileContent || '', fileName || 'document', fileType || 'txt', aiConfig);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error || '分析失败');
    console.error('[Analyze API Error]', msg);
    return NextResponse.json({ error: msg }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
  }
}

async function analyzeImage(imageBase64: string, fileName: string, aiConfig?: Partial<RuntimeAIConfig>): Promise<NextResponse> {
  if (!hasRuntimeAIProvider(aiConfig) && !hasServerFallbackModel()) {
    return NextResponse.json({
      success: false,
      error: '未配置视觉模型，图片内容尚未识别。',
    }, { status: 503 });
  }

  const prompt = `请仔细分析这张图片，提取其中的学术信息。

如果是学术论文截图或PDF截图，请提取：标题、作者、年份、关键词、摘要。
如果是数据图表/统计图，请描述：图表类型、关键数据点、趋势、结论。
如果是实验装置/流程图，请描述：流程步骤、关键组件。
如果是其他学术相关图片，请详细描述其内容。

请严格按以下JSON格式返回：
{
  "title": "提取的标题或图片主题",
  "authors": ["作者1", "作者2"],
  "year": 发表年份,
  "journal": "期刊/会议名称（如无法识别则为空字符串）",
  "doi": "DOI编号（如无法识别则为空字符串）",
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "abstract": "内容摘要（200字以内）",
  "content": "详细内容描述（包含所有可见的文字信息和关键数据）"
}`;

  try {
    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: prompt },
          { type: 'image_url' as const, image_url: { url: imageBase64 } },
        ],
      },
    ];

    const fullContent = await llmInvoke(messages, {
      model: 'doubao-seed-1-6-vision-250815',
      temperature: 0.3,
      thinking: 'disabled',
      vision: true,
    }, undefined, aiConfig);

    const parsed = parseJsonFromResponse(fullContent, fileName, true);
    return NextResponse.json({ success: true, analysis: parsed });
  } catch (err) {
    console.error('[Analyze] Vision model failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: '图片识别失败，未生成识别正文，请稍后重试。' }, { status: 502 });
  }
}

async function analyzeText(fileContent: string, fileName: string, fileType: string, aiConfig?: Partial<RuntimeAIConfig>): Promise<NextResponse> {
  if (!hasRuntimeAIProvider(aiConfig) && !hasServerFallbackModel()) {
    return NextResponse.json({
      success: false,
      analysis: fallbackAnalysis(fileName, fileContent, '未配置文本模型，已使用原文生成基础资料记录。'),
    });
  }

  const contentTypeLabel = {
    pdf: 'PDF文档',
    docx: 'Word文档',
    doc: 'Word文档',
    xlsx: 'Excel表格',
    pptx: 'PowerPoint演示文稿',
    ppt: 'PowerPoint演示文稿',
    txt: '文本文件',
    md: 'Markdown文档',
    csv: 'CSV数据表',
  }[fileType] || '文档';

  const prompt = `请分析以下${contentTypeLabel}的内容，提取其中的关键学术信息。文件名：${fileName}，类型：${fileType}。

文件内容：
${fileContent.slice(0, 15000)}

请严格按以下JSON格式返回：
{
  "title": "论文标题或文档主题（如无法识别则用文件名）",
  "authors": ["第一作者", "第二作者"],
  "year": 发表年份,
  "journal": "期刊/会议名称（如无法识别则为空字符串）",
  "doi": "DOI编号（如无法识别则为空字符串）",
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "abstract": "论文摘要或核心内容概述（200字以内）",
  "content": "按原文顺序简要摘录或列点；短资料可直接保留原文，不补写背景、方法、意义或建议"
}

注意：
1. 如果内容是学术论文，仅提取原文明示的标题、作者、摘要、关键词、方法、发现和结论
2. 如果内容是数据表格，请总结数据特征、关键数值和趋势
3. 如果内容是演示文稿，请总结各页的核心要点
4. 原文没有作者时authors为[]，不要根据文件名或叙述对象推断作者
5. year只填写原文明示的发表年份，数值类型；原文没有年份时为null，不用当前年份代替
6. journal和doi仅对学术论文有效，其他类型文档可留空
7. 不为凑字数扩写；保留原文数字、单位、条件、否定和模拟资料标签；不要添加评价、建议或无依据的归因
8. 必须返回有效的JSON格式`;

  try {
    const messages = [
      { role: 'system' as const, content: '只从给定文件提取信息，按要求返回JSON；原文未写的内容不补写。' },
      { role: 'user' as const, content: prompt },
    ];

    const fullContent = await llmInvoke(messages, {
      model: 'doubao-seed-2-0-pro-260215',
      auxiliary: true,
      temperature: 0.3,
      thinking: 'disabled',
    }, undefined, aiConfig);

    const parsed = parseJsonFromResponse(fullContent, fileName);
    return NextResponse.json({ success: true, analysis: parsed });
  } catch (err) {
    console.error('[Analyze] Text model failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({
      success: false,
      analysis: fallbackAnalysis(fileName, fileContent),
    });
  }
}

function parseJsonFromResponse(response: string, fileName: string, requireContent = false): Record<string, unknown> {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (requireContent && (typeof parsed?.content !== 'string' || !parsed.content.trim())) throw new Error('图片识别未返回有效正文');
      if (typeof parsed.year === 'string' && /^\d{4}$/.test(parsed.year.trim())) {
        parsed.year = Number(parsed.year.trim());
      }
      return parsed;
    }
    throw new Error('No JSON found');
  } catch (error) {
    if (requireContent) throw error;
    return {
      title: fileName.replace(/\.[^.]+$/, '') || '未解析文档',
      authors: [],
      year: null,
      keywords: ['原始数据'],
      abstract: response.slice(0, 200),
      content: response,
    };
  }
}
