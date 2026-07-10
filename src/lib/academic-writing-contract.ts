export type AcademicWritingStatus = 'complete' | 'incomplete' | 'no-evidence';
export type AcademicWritingSection = 'introduction' | 'related-work' | 'discussion';
export type AcademicParagraphRole = 'opening' | 'challenge' | 'method' | 'advantage' | 'evidence' | 'limitation';
export type ClaimSupportStatus = 'supported' | 'needs-evidence';

export interface AcademicWritingDraft {
  title: string;
  targetSection: AcademicWritingSection;
  outline: Array<{ heading: string; purpose: string }>;
  paragraphs: Array<{
    role: AcademicParagraphRole;
    text: string;
    evidenceMarkers: number[];
    supportStatus: ClaimSupportStatus;
  }>;
  claimEvidenceMap: Array<{
    claim: string;
    evidence: string;
    evidenceMarkers: number[];
    status: ClaimSupportStatus;
  }>;
  limitations: string[];
  revisionChecklist: string[];
}

export interface AcademicWritingPromptInput {
  writingGoal: string;
  targetSection: AcademicWritingSection;
  audience: string;
  requirements: string;
  sourceCount: number;
  evidenceContext: string;
}

const SECTION_LABELS: Record<AcademicWritingSection, string> = {
  introduction: '引言',
  'related-work': '相关工作',
  discussion: '讨论',
};

export function buildAcademicWritingPrompt(input: AcademicWritingPromptInput): string {
  return `请基于当前已选来源，起草一份可继续编辑的学术论文${SECTION_LABELS[input.targetSection]}章节。

写作目标：${input.writingGoal.trim()}
目标读者：${input.audience.trim() || '尚未指定，请采用通用学术读者。'}
结构要求：${input.requirements.trim() || '请按该章节的学术功能组织 3–7 个大纲点。'}

写作纪律：
- 一段一义，首句说明段落作用；句间关系清楚，并为每段标注 opening/challenge/method/advantage/evidence/limitation 角色。
- 只能使用当前 ${input.sourceCount} 个已选来源及下方证据片段。候选引用不等于真实性和格式已经核验，必须提醒回到原文确认。
- 不负责文献发现，也不负责引用真实性、DOI 或期刊格式核验。
- 不得编造实验、数据、样本量、百分比、统计结论、新发现、作者观点或来源编号；不得声称 Word/LaTeX、期刊模板适配或投稿已经完成。
- supported 段落和 supported claim 必须至少带一个有效 evidenceMarkers；证据不足的主张标为 needs-evidence，不能用肯定语气冒充事实。
- 保留证据中的术语、事实和数字；证据没有提供的数字不得补写。

只输出一个 JSON 对象，不要输出 Markdown 围栏或额外说明。结构严格为：
{
  "title": "章节标题",
  "targetSection": "introduction|related-work|discussion",
  "outline": [{ "heading": "紧凑小标题", "purpose": "本部分作用" }],
  "paragraphs": [{ "role": "opening|challenge|method|advantage|evidence|limitation", "text": "段落正文，引用用[1]", "evidenceMarkers": [1], "supportStatus": "supported|needs-evidence" }],
  "claimEvidenceMap": [{ "claim": "主张", "evidence": "对应证据或缺口", "evidenceMarkers": [1], "status": "supported|needs-evidence" }],
  "limitations": ["来源、证据覆盖和写作边界"],
  "revisionChecklist": ["需由作者继续核验和补充的事项"]
}

要求：outline 为 3–7 项；paragraphs 至少 2 段；claimEvidenceMap 至少 1 项；每个 supported 项都必须有证据编号。

证据片段：
${input.evidenceContext}`;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('学术写作结构不完整：未找到 JSON 对象。');
  try {
    const value = JSON.parse(trimmed.slice(start, end + 1));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error('学术写作结构不完整：JSON 无法解析。');
  }
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`学术写作结构不完整：${field} 必须是对象。`);
  }
  return value as Record<string, unknown>;
}

function textValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length < 2) {
    throw new Error(`学术写作结构不完整：缺少 ${field}。`);
  }
  return value.trim();
}

function textList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`学术写作结构不完整：${field} 不能为空。`);
  return value.map((item, index) => textValue(item, `${field}[${index}]`));
}

function markers(value: unknown, field: string): number[] {
  if (!Array.isArray(value)) throw new Error(`学术写作结构不完整：${field} 必须是数组。`);
  return [...new Set(value.filter(item => Number.isInteger(item) && Number(item) > 0).map(Number))];
}

function supportStatus(value: unknown, field: string): ClaimSupportStatus {
  if (value !== 'supported' && value !== 'needs-evidence') {
    throw new Error(`学术写作结构不完整：${field} 必须是 supported 或 needs-evidence。`);
  }
  return value;
}

export function parseAcademicWritingOutput(raw: string): AcademicWritingDraft {
  const parsed = parseJsonObject(raw);
  const targetSection = parsed.targetSection;
  if (targetSection !== 'introduction' && targetSection !== 'related-work' && targetSection !== 'discussion') {
    throw new Error('学术写作结构不完整：targetSection 无效。');
  }
  if (!Array.isArray(parsed.outline) || parsed.outline.length < 3 || parsed.outline.length > 7) {
    throw new Error('学术写作结构不完整：outline 必须包含 3–7 项。');
  }
  const outline = parsed.outline.map((item, index) => {
    const value = objectValue(item, `outline[${index}]`);
    return { heading: textValue(value.heading, `outline[${index}].heading`), purpose: textValue(value.purpose, `outline[${index}].purpose`) };
  });
  if (!Array.isArray(parsed.paragraphs) || parsed.paragraphs.length < 2) {
    throw new Error('学术写作结构不完整：paragraphs 至少需要两段。');
  }
  const roles: AcademicParagraphRole[] = ['opening', 'challenge', 'method', 'advantage', 'evidence', 'limitation'];
  const paragraphs = parsed.paragraphs.map((item, index) => {
    const value = objectValue(item, `paragraphs[${index}]`);
    if (!roles.includes(value.role as AcademicParagraphRole)) throw new Error(`学术写作结构不完整：paragraphs[${index}].role 无效。`);
    const status = supportStatus(value.supportStatus, `paragraphs[${index}].supportStatus`);
    const evidenceMarkers = markers(value.evidenceMarkers, `paragraphs[${index}].evidenceMarkers`);
    if (status === 'supported' && evidenceMarkers.length === 0) {
      throw new Error(`学术写作结构不完整：supported 段落必须包含证据编号（paragraphs[${index}]）。`);
    }
    return { role: value.role as AcademicParagraphRole, text: textValue(value.text, `paragraphs[${index}].text`), evidenceMarkers, supportStatus: status };
  });
  if (!Array.isArray(parsed.claimEvidenceMap) || parsed.claimEvidenceMap.length === 0) {
    throw new Error('学术写作结构不完整：claimEvidenceMap 不能为空。');
  }
  const claimEvidenceMap = parsed.claimEvidenceMap.map((item, index) => {
    const value = objectValue(item, `claimEvidenceMap[${index}]`);
    const status = supportStatus(value.status, `claimEvidenceMap[${index}].status`);
    const evidenceMarkers = markers(value.evidenceMarkers, `claimEvidenceMap[${index}].evidenceMarkers`);
    if (status === 'supported' && evidenceMarkers.length === 0) {
      throw new Error(`学术写作结构不完整：supported claim 必须包含证据编号（claimEvidenceMap[${index}]）。`);
    }
    return {
      claim: textValue(value.claim, `claimEvidenceMap[${index}].claim`),
      evidence: textValue(value.evidence, `claimEvidenceMap[${index}].evidence`),
      evidenceMarkers,
      status,
    };
  });
  return {
    title: textValue(parsed.title, 'title'),
    targetSection,
    outline,
    paragraphs,
    claimEvidenceMap,
    limitations: textList(parsed.limitations, 'limitations'),
    revisionChecklist: textList(parsed.revisionChecklist, 'revisionChecklist'),
  };
}

export function classifyAcademicWritingDraft(input: { draft: AcademicWritingDraft; citationCount: number }): AcademicWritingStatus {
  if (input.citationCount === 0) return 'no-evidence';
  const used = [
    ...input.draft.paragraphs.flatMap(item => item.evidenceMarkers),
    ...input.draft.claimEvidenceMap.flatMap(item => item.evidenceMarkers),
  ];
  if (!used.some(marker => marker >= 1 && marker <= input.citationCount)) return 'no-evidence';
  return used.some(marker => marker < 1 || marker > input.citationCount) ? 'incomplete' : 'complete';
}

export function hasSubstantiveWritingEvidence(citations: Array<{ excerpt?: string; snippet?: string }>): boolean {
  return citations.some(citation => (citation.excerpt || citation.snippet || '').replace(/\s+/g, ' ').trim().length >= 40);
}

export function buildAcademicWritingMarkdown(draft: AcademicWritingDraft): string {
  const sectionLabel = SECTION_LABELS[draft.targetSection];
  return `# ${draft.title}

> 草稿类型：${sectionLabel}。仅基于当前已选来源片段；候选引用仍需回到原文核验。本文件不是期刊格式稿、Word/LaTeX 成品或投稿完成证明。

## 写作大纲
${draft.outline.map((item, index) => `${index + 1}. **${item.heading}**：${item.purpose}`).join('\n')}

## 章节草稿
${draft.paragraphs.map(item => `<!-- role: ${item.role}; support: ${item.supportStatus} -->\n${item.text}`).join('\n\n')}

## Claim-Evidence 映射
${draft.claimEvidenceMap.map(item => `- **${item.claim}** | ${item.evidence} | ${item.evidenceMarkers.map(marker => `[${marker}]`).join('、') || '待补证据'} | ${item.status}`).join('\n')}

## 局限与修订清单
### 局限
${draft.limitations.map(item => `- ${item}`).join('\n')}
### 作者待办
${draft.revisionChecklist.map(item => `- ${item}`).join('\n')}
`;
}
