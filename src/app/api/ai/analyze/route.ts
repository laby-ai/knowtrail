import { NextRequest, NextResponse } from 'next/server';
import { llmInvoke } from '@/lib/ai-service';
import { resolveRequestRuntimeAIConfigResult } from '@/lib/bailian-provider-profile';
import type { RuntimeAIConfig } from '@/types';

const isImageType = (ext: string) => ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);

function fallbackAnalysis(fileName: string, fileContent: string, abstract = 'AI分析暂时不可用，请稍后重试') {
  return {
    title: fileName.replace(/\.[^.]+$/, '') || '未解析文档',
    authors: ['未解析作者'],
    year: new Date().getFullYear(),
    keywords: ['原始数据'],
    abstract,
    content: fileContent ? fileContent.slice(0, 2000) : abstract,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { fileContent, fileName, fileType, imageBase64, aiConfig } = await request.json() as {
      fileContent?: string;
      fileName?: string;
      fileType?: string;
      imageBase64?: string;
      aiConfig?: Partial<RuntimeAIConfig>;
    };

    if (!fileContent && !fileName && !imageBase64) {
      return NextResponse.json({ error: '缺少文件内容' }, { status: 400 });
    }
    const runtimeConfigResult = await resolveRequestRuntimeAIConfigResult(request, aiConfig);
    if (runtimeConfigResult instanceof Response) return runtimeConfigResult;
    const runtimeConfig = runtimeConfigResult;

    const isImage = isImageType(fileType || '');

    if (isImage && imageBase64) {
      return await analyzeImage(imageBase64, fileName || 'image', runtimeConfig);
    }

    // 文本类文件走 LLM 分析
    return await analyzeText(fileContent || '', fileName || 'document', fileType || 'txt', runtimeConfig);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error || '分析失败');
    console.error('[Analyze API Error]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function analyzeImage(imageBase64: string, fileName: string, aiConfig?: Partial<RuntimeAIConfig>): Promise<NextResponse> {
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

    const parsed = parseJsonFromResponse(fullContent, fileName);
    return NextResponse.json({ success: true, analysis: parsed });
  } catch (err) {
    console.error('[Analyze] Vision model failed:', err instanceof Error ? err.message : String(err));
    return await analyzeText(`[图片文件: ${fileName}]`, fileName, 'image', aiConfig);
  }
}

async function analyzeText(fileContent: string, fileName: string, fileType: string, aiConfig?: Partial<RuntimeAIConfig>): Promise<NextResponse> {
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
  "content": "论文核心内容的结构化总结（包含研究目的、方法、主要发现、结论，至少500字）"
}

注意：
1. 如果内容是学术论文，请完整提取标题、作者、摘要、关键词、研究方法、主要发现、结论
2. 如果内容是数据表格，请总结数据特征、关键数值和趋势
3. 如果内容是演示文稿，请总结各页的核心要点
4. authors如无法识别则写["未知作者"]
5. year如无法识别则用当前年份
6. journal和doi仅对学术论文有效，其他类型文档可留空
7. content字段请尽量详细，至少500字，包含文档中的关键信息
8. 必须返回有效的JSON格式`;

  try {
    const messages = [
      { role: 'system' as const, content: '你是一位学术论文分析专家，擅长从各种文件中提取关键学术信息。请始终返回有效的JSON格式。' },
      { role: 'user' as const, content: prompt },
    ];

    const fullContent = await llmInvoke(messages, {
      model: 'doubao-seed-2-0-pro-260215',
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

function parseJsonFromResponse(response: string, fileName: string): Record<string, unknown> {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('No JSON found');
  } catch {
    return {
      title: fileName.replace(/\.[^.]+$/, '') || '未解析文档',
      authors: ['未解析作者'],
      year: new Date().getFullYear(),
      keywords: ['原始数据'],
      abstract: response.slice(0, 200),
      content: response,
    };
  }
}
