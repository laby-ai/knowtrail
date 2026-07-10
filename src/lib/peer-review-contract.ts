export type PeerReviewPerspective = 'overall' | 'methodology' | 'evidence' | 'clarity';
export type PeerReviewEvidenceStatus = 'manuscript' | 'source-supported' | 'needs-verification';

export interface PeerReviewComment {
  location: string;
  excerpt: string;
  problem: string;
  importance: string;
  action: string;
  evidenceStatus: PeerReviewEvidenceStatus;
  evidenceMarkers: number[];
}

export interface PeerReviewReport {
  title: string;
  summary: {
    manuscriptFocus: string;
    overallAssessment: string;
  };
  strengths: string[];
  majorComments: PeerReviewComment[];
  minorComments: PeerReviewComment[];
  questions: string[];
  limitations: string[];
}

export interface PeerReviewAudit {
  safe: boolean;
  unlocatedComments: string[];
  invalidEvidenceMarkers: number[];
  unsupportedEvidenceClaims: string[];
  editorialScores: string[];
}

const PERSPECTIVE_LABELS: Record<PeerReviewPerspective, string> = {
  overall: '全文逻辑与整体可靠性',
  methodology: '研究设计、方法与统计严谨性',
  evidence: '主张、结果与证据边界',
  clarity: '结构、术语与表达清晰度',
};

export function buildPeerReviewPrompt(input: {
  manuscript: string;
  scope: string;
  perspective: PeerReviewPerspective;
  sourceCount: number;
  evidenceContext: string;
}): string {
  return `请对下面的稿件文本执行一次单一审查视角的只读论文审查。

审查范围：${input.scope.trim() || '用户提供的全部稿件文本'}
审查视角：${PERSPECTIVE_LABELS[input.perspective]}

审查纪律：
- 只读：只产出审查报告，不得直接改稿，不得把建议后的文字冒充作者修订稿。
- 只采用当前这一种审查视角，不得模拟多个审稿人、主编或所谓多代理共识。
- 每条 Major/Minor comment 必须提供稿件中的确切片段 excerpt，并用 location 定位到节、段、句、图或表；excerpt 必须能在原文中逐字定位。
- 每条意见必须说明 problem、importance 和可执行 action。禁止泛泛而谈、编造实验缺陷、引用、事实或作者意图。
- evidenceStatus 只能是 manuscript、source-supported 或 needs-verification。稿件文本可直接判断的问题用 manuscript；外部来源明确支持且带有效 evidenceMarkers 时才用 source-supported；无法从稿件或来源确认的事项必须标为 needs-verification，不能写成既定事实。
- 当前提供 ${input.sourceCount} 个外部来源。候选来源片段不等于引用真实性或格式已经核验；不得编造来源编号。
- 不给 Accept/Reject/Major Revision/Minor Revision 推荐，不打分，不虚构编辑决定。
- 稿件未提供的原始数据、代码、完整图表、伦理文件或参考文献，必须列入 limitations 或标为待核验，不能擅自判定通过或失败。

只输出一个 JSON 对象，不要输出 Markdown 围栏或额外说明：
{
  "title": "审查报告标题",
  "summary": { "manuscriptFocus": "稿件研究内容概述", "overallAssessment": "不含接收/拒稿决定的总体判断" },
  "strengths": ["可从稿件定位的具体优点"],
  "majorComments": [{ "location": "节/段/图表位置", "excerpt": "稿件确切片段", "problem": "问题是什么", "importance": "为何重要", "action": "建议作者采取的动作", "evidenceStatus": "manuscript|source-supported|needs-verification", "evidenceMarkers": [1] }],
  "minorComments": [{ "location": "节/段/图表位置", "excerpt": "稿件确切片段", "problem": "问题是什么", "importance": "为何重要", "action": "建议作者采取的动作", "evidenceStatus": "manuscript|source-supported|needs-verification", "evidenceMarkers": [] }],
  "questions": ["需要作者回答的问题"],
  "limitations": ["本次审查无法核验的材料或边界"]
}

要求：strengths 至少 1 项；Major/Minor comments 合计至少 1 项；questions 和 limitations 均至少 1 项。

外部证据片段：
${input.evidenceContext.trim() || '未选择外部来源；所有外部事实均必须标为 needs-verification。'}

稿件原文：
${input.manuscript.trim()}`;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('论文审查结构不完整：未找到 JSON 对象。');
  try {
    const value = JSON.parse(trimmed.slice(start, end + 1));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error('论文审查结构不完整：JSON 无法解析。');
  }
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`论文审查结构不完整：${field} 必须是对象。`);
  }
  return value as Record<string, unknown>;
}

function textValue(value: unknown, field: string, minLength = 2): string {
  if (typeof value !== 'string' || value.trim().length < minLength) {
    throw new Error(`论文审查结构不完整：缺少 ${field}。`);
  }
  return value.trim();
}

function textList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`论文审查结构不完整：${field} 不能为空。`);
  return value.map((item, index) => textValue(item, `${field}[${index}]`));
}

function markers(value: unknown, field: string): number[] {
  if (!Array.isArray(value)) throw new Error(`论文审查结构不完整：${field} 必须是数组。`);
  return [...new Set(value.filter(Number.isInteger).map(Number))];
}

function evidenceStatus(value: unknown, field: string): PeerReviewEvidenceStatus {
  if (value !== 'manuscript' && value !== 'source-supported' && value !== 'needs-verification') {
    throw new Error(`论文审查结构不完整：${field} 无效。`);
  }
  return value;
}

function commentList(value: unknown, field: string): PeerReviewComment[] {
  if (!Array.isArray(value)) throw new Error(`论文审查结构不完整：${field} 必须是数组。`);
  return value.map((item, index) => {
    const comment = objectValue(item, `${field}[${index}]`);
    return {
      location: textValue(comment.location, `${field}[${index}].location`),
      excerpt: textValue(comment.excerpt, `${field}[${index}].excerpt`, 4),
      problem: textValue(comment.problem, `${field}[${index}].problem`),
      importance: textValue(comment.importance, `${field}[${index}].importance`),
      action: textValue(comment.action, `${field}[${index}].action`),
      evidenceStatus: evidenceStatus(comment.evidenceStatus, `${field}[${index}].evidenceStatus`),
      evidenceMarkers: markers(comment.evidenceMarkers, `${field}[${index}].evidenceMarkers`),
    };
  });
}

export function parsePeerReviewOutput(raw: string): PeerReviewReport {
  const parsed = parseJsonObject(raw);
  const summary = objectValue(parsed.summary, 'summary');
  const majorComments = commentList(parsed.majorComments, 'majorComments');
  const minorComments = commentList(parsed.minorComments, 'minorComments');
  if (majorComments.length + minorComments.length === 0) {
    throw new Error('论文审查结构不完整：Major/Minor comments 合计至少需要一项。');
  }
  return {
    title: textValue(parsed.title, 'title'),
    summary: {
      manuscriptFocus: textValue(summary.manuscriptFocus, 'summary.manuscriptFocus'),
      overallAssessment: textValue(summary.overallAssessment, 'summary.overallAssessment'),
    },
    strengths: textList(parsed.strengths, 'strengths'),
    majorComments,
    minorComments,
    questions: textList(parsed.questions, 'questions'),
    limitations: textList(parsed.limitations, 'limitations'),
  };
}

function normalized(value: string): string {
  return value.normalize('NFKC').replace(/[\s\u00a0]+/g, '').toLocaleLowerCase();
}

function reportText(report: PeerReviewReport): string {
  const comments = [...report.majorComments, ...report.minorComments];
  return [
    report.title,
    report.summary.manuscriptFocus,
    report.summary.overallAssessment,
    ...report.strengths,
    ...comments.flatMap(item => [item.location, item.excerpt, item.problem, item.importance, item.action]),
    ...report.questions,
    ...report.limitations,
  ].join('\n');
}

export function auditPeerReviewReport(manuscript: string, report: PeerReviewReport, citationCount: number): PeerReviewAudit {
  const manuscriptText = normalized(manuscript);
  const comments = [...report.majorComments, ...report.minorComments];
  const unlocatedComments = comments
    .filter(comment => !manuscriptText.includes(normalized(comment.excerpt)))
    .map(comment => `${comment.location}: ${comment.excerpt}`);
  const invalidEvidenceMarkers = [...new Set(comments.flatMap(comment => comment.evidenceMarkers)
    .filter(marker => marker < 1 || marker > citationCount))].sort((a, b) => a - b);
  const unsupportedEvidenceClaims = comments.flatMap(comment => {
    const validMarkers = comment.evidenceMarkers.filter(marker => marker >= 1 && marker <= citationCount);
    if (comment.evidenceStatus === 'source-supported' && validMarkers.length === 0) {
      return [`${comment.location}: 来源支持状态缺少有效证据编号`];
    }
    if (comment.evidenceStatus !== 'source-supported' && comment.evidenceMarkers.length > 0) {
      return [`${comment.location}: ${comment.evidenceStatus} 状态不应携带外部证据编号`];
    }
    return [];
  });
  const editorialPattern = /\b(?:accept|reject|minor\s+revision|major\s+revision)\b|(?:推荐|建议).{0,8}(?:接收|拒稿|大修|小修)|(?:评分|得分)|\b\d+(?:\.\d+)?\s*\/\s*(?:5|10|100)\b/gi;
  const editorialScores = [...new Set(reportText(report).match(editorialPattern) || [])];
  return {
    safe: unlocatedComments.length === 0
      && invalidEvidenceMarkers.length === 0
      && unsupportedEvidenceClaims.length === 0
      && editorialScores.length === 0,
    unlocatedComments,
    invalidEvidenceMarkers,
    unsupportedEvidenceClaims,
    editorialScores,
  };
}

function renderComment(comment: PeerReviewComment, index: number): string {
  const evidence = comment.evidenceStatus === 'source-supported'
    ? `来源支持 ${comment.evidenceMarkers.map(marker => `[${marker}]`).join('、')}`
    : comment.evidenceStatus === 'manuscript' ? '稿件内证据' : '待核验';
  return `${index + 1}. **位置**：${comment.location}\n   - **原文片段**：“${comment.excerpt}”\n   - **问题**：${comment.problem}\n   - **为何重要**：${comment.importance}\n   - **建议动作**：${comment.action}\n   - **证据状态**：${evidence}`;
}

export function buildPeerReviewMarkdown(report: PeerReviewReport, audit: PeerReviewAudit): string {
  return `# ${report.title}

> 本报告只读，不直接修改稿件；不代表引用、原始数据、统计分析、伦理材料或编辑决定已经核验。

## 总评

**稿件内容**：${report.summary.manuscriptFocus}

**总体判断**：${report.summary.overallAssessment}

## 主要优点

${report.strengths.map(item => `- ${item}`).join('\n')}

## Major Comments

${report.majorComments.length ? report.majorComments.map(renderComment).join('\n\n') : '- 无。'}

## Minor Comments

${report.minorComments.length ? report.minorComments.map(renderComment).join('\n\n') : '- 无。'}

## 给作者的问题

${report.questions.map(item => `- ${item}`).join('\n')}

## 审查边界

${report.limitations.map(item => `- ${item}`).join('\n')}

## 结构审计

- 状态：${audit.safe ? '通过' : '未通过'}
- 无法定位的意见：${audit.unlocatedComments.join('；') || '无'}
- 无效证据编号：${audit.invalidEvidenceMarkers.join('、') || '无'}
- 证据状态冲突：${audit.unsupportedEvidenceClaims.join('；') || '无'}
- 编辑决定或评分：${audit.editorialScores.join('、') || '无'}
`;
}
