export type PaperReadingMode = 'translation' | 'paragraph-summary' | 'full-summary';
export type PaperReadingStatus = 'complete' | 'incomplete' | 'no-evidence';

export interface PaperReadingSection {
  label: string;
  sourceText: string;
  content: string;
  evidenceMarkers: number[];
}

export interface PaperReadingResult {
  title: string;
  mode: PaperReadingMode;
  sourceLanguage: string;
  targetLanguage: string;
  sections: PaperReadingSection[];
  keyTerms: Array<{ source: string; target: string }>;
  limitations: string[];
}

export interface PaperReadingPromptInput {
  mode: PaperReadingMode;
  sourceTitle: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceCount: number;
  evidenceContext: string;
}

const MODE_LABELS: Record<PaperReadingMode, string> = {
  translation: '外文翻译',
  'paragraph-summary': '逐段总结',
  'full-summary': '全文结构化总结',
};

const FULL_SUMMARY_LABELS = ['研究背景', '研究问题', '研究方法', '主要发现', '创新贡献', '局限'];

export function buildPaperReadingPrompt(input: PaperReadingPromptInput): string {
  const modeRule = input.mode === 'translation'
    ? `按原文段落顺序翻译为${input.targetLanguage}；sourceText 保留对应原文，content 给出忠实译文，专业术语写入 keyTerms。`
    : input.mode === 'paragraph-summary'
      ? '按证据片段或章节顺序逐段概括；每项 label 使用章节名或“段落 N”，sourceText 保留可定位的原文摘录。'
      : `sections 必须依次覆盖：${FULL_SUMMARY_LABELS.join('、')}。缺少证据的部分要明确写“当前证据不足”，不得补写。`;

  return `请完成论文精读任务：${MODE_LABELS[input.mode]}。

机器可读模式：${input.mode}
来源标题：${input.sourceTitle}
来源语言：${input.sourceLanguage || '自动识别'}
目标语言：${input.targetLanguage}
当前来源数：${input.sourceCount}

任务规则：
- ${modeRule}
- 只能使用下方证据片段，不得编造实验、数据、样本量、统计结论、作者观点或引用。
- 每个有实质事实或结论的 section 都必须填写 evidenceMarkers，并在 content 中使用 [1]、[2] 这样的编号。
- 局限或“当前证据不足”可以不带编号，但不能写成已证实结论。
- 候选证据不代表全文和引用真实性已经核验，limitations 必须提醒回到原文确认。

只输出一个 JSON 对象，不要输出 Markdown 围栏或额外说明：
{
  "title": "结果标题",
  "mode": "${input.mode}",
  "sourceLanguage": "${input.sourceLanguage || '自动识别'}",
  "targetLanguage": "${input.targetLanguage}",
  "sections": [
    { "label": "章节或结构标签", "sourceText": "对应原文摘录；全文总结可为空", "content": "译文或总结[1]", "evidenceMarkers": [1] }
  ],
  "keyTerms": [{ "source": "原文术语", "target": "目标语言术语" }],
  "limitations": ["证据覆盖与人工核验边界"]
}

证据片段：
${input.evidenceContext}`;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('精读结果结构不完整：未找到 JSON 对象。');
  try {
    const value = JSON.parse(trimmed.slice(start, end + 1));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error('精读结果结构不完整：JSON 无法解析。');
  }
}

function text(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length < 2)) {
    throw new Error(`精读结果结构不完整：缺少 ${field}。`);
  }
  return value.trim();
}

function textList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`精读结果结构不完整：${field} 不能为空。`);
  return value.map((item, index) => text(item, `${field}[${index}]`));
}

function markers(value: unknown, field: string): number[] {
  if (!Array.isArray(value)) throw new Error(`精读结果结构不完整：${field} 必须是数组。`);
  return [...new Set(value.filter(item => Number.isInteger(item) && Number(item) > 0).map(Number))];
}

function isMode(value: unknown): value is PaperReadingMode {
  return value === 'translation' || value === 'paragraph-summary' || value === 'full-summary';
}

function allowsUncitedSection(label: string, content: string): boolean {
  return /局限|待核验|证据不足|无法判断/.test(`${label} ${content}`);
}

export function parsePaperReadingOutput(raw: string): PaperReadingResult {
  const parsed = parseJsonObject(raw);
  if (!isMode(parsed.mode)) throw new Error('精读结果结构不完整：mode 无效。');
  if (!Array.isArray(parsed.sections) || parsed.sections.length === 0) {
    throw new Error('精读结果结构不完整：sections 不能为空。');
  }

  const sections = parsed.sections.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`精读结果结构不完整：sections[${index}] 必须是对象。`);
    }
    const section = item as Record<string, unknown>;
    const label = text(section.label, `sections[${index}].label`);
    const content = text(section.content, `sections[${index}].content`);
    const evidenceMarkers = markers(section.evidenceMarkers, `sections[${index}].evidenceMarkers`);
    if (evidenceMarkers.length === 0 && !allowsUncitedSection(label, content)) {
      throw new Error(`精读结果结构不完整：sections[${index}] 的实质内容必须包含证据编号。`);
    }
    return {
      label,
      sourceText: text(section.sourceText, `sections[${index}].sourceText`, true),
      content,
      evidenceMarkers,
    };
  });

  if (parsed.mode === 'full-summary') {
    const labels = sections.map(section => section.label);
    for (const required of FULL_SUMMARY_LABELS) {
      if (!labels.includes(required)) throw new Error(`精读结果结构不完整：全文总结缺少“${required}”。`);
    }
  }

  const keyTerms = Array.isArray(parsed.keyTerms)
    ? parsed.keyTerms.map((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new Error(`精读结果结构不完整：keyTerms[${index}] 必须是对象。`);
        }
        const term = item as Record<string, unknown>;
        return {
          source: text(term.source, `keyTerms[${index}].source`),
          target: text(term.target, `keyTerms[${index}].target`),
        };
      })
    : [];

  return {
    title: text(parsed.title, 'title'),
    mode: parsed.mode,
    sourceLanguage: text(parsed.sourceLanguage, 'sourceLanguage'),
    targetLanguage: text(parsed.targetLanguage, 'targetLanguage'),
    sections,
    keyTerms,
    limitations: textList(parsed.limitations, 'limitations'),
  };
}

export function classifyPaperReadingResult(input: {
  result: PaperReadingResult;
  citationCount: number;
}): PaperReadingStatus {
  if (input.citationCount === 0) return 'no-evidence';
  const markers = input.result.sections.flatMap(section => section.evidenceMarkers);
  if (!markers.some(marker => marker >= 1 && marker <= input.citationCount)) return 'no-evidence';
  return markers.some(marker => marker > input.citationCount) ? 'incomplete' : 'complete';
}

export function buildPaperReadingMarkdown(result: PaperReadingResult): string {
  return `# ${result.title}

> 任务：${MODE_LABELS[result.mode]}。来源语言：${result.sourceLanguage}；目标语言：${result.targetLanguage}。候选证据仍需回到原文核验。

${result.sections.map(section => `## ${section.label}
${section.sourceText ? `> 原文：${section.sourceText}\n\n` : ''}${section.content}`).join('\n\n')}

${result.keyTerms.length ? `## 术语对照\n${result.keyTerms.map(term => `- ${term.source}：${term.target}`).join('\n')}\n\n` : ''}## 局限与核验
${result.limitations.map(item => `- ${item}`).join('\n')}
`;
}
