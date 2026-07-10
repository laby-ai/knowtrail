import type { CitationAuditStatus, CitationSectionCoverageResult } from '@/lib/citation-audit';

export const DEEP_RESEARCH_REQUIRED_SECTIONS = [
  '研究问题',
  '研究边界',
  '关键词',
  '证据来源',
  '主要结论',
  '分论点',
  '争议或不足',
  '可实操路线',
  '还需要核验',
] as const;

export type DeepResearchAnswerStatus = 'complete' | 'incomplete' | 'no-evidence';

export interface DeepResearchPromptInput {
  question: string;
  evidenceContext: string;
  sourceCount: number;
}

export function buildDeepResearchPrompt(input: DeepResearchPromptInput): string {
  const sections = DEEP_RESEARCH_REQUIRED_SECTIONS.map(section => `## ${section}`).join('\n');
  return `请完成一份基于已选来源的深度研究报告。

研究问题：
${input.question.trim()}

证据边界：
- 只能基于已选来源及下方检索到的证据片段，不得声称已完成全网检索。
- 当前共选择 ${input.sourceCount} 个来源；引用线索是候选证据，不代表已核验全文。
- 每个事实判断、比较结论和方法建议都必须在标点前标注对应证据编号，如“结论[1]。”或“比较结果[1][2]。”。
- 每个二级标题下只写带证据编号的独立陈述，优先使用“- 陈述[1]。”格式；一行有多句话时，每句话都必须分别带引用编号。
- 除 Markdown 标题外，不要输出无引用的引言、过渡句、标签或总结；任何不含引用编号的陈述都会使报告判定为未完成。
- 证据不足时明确写入“还需要核验”，不要补写不存在的 DOI、引用量、期刊等级或统计结果。

必须按以下 Markdown 二级标题完整输出：
${sections}

证据片段：
${input.evidenceContext}`;
}

export function buildDeepResearchRepairPrompt(input: DeepResearchPromptInput): string {
  const sections = DEEP_RESEARCH_REQUIRED_SECTIONS.map(section => `## ${section}\n- 仅写一个可由证据支持的单句陈述[1]。`).join('\n\n');
  return `上一版报告未通过引用覆盖审计。请仅根据下方证据重新生成完整报告，不要复述上一版。

研究问题：${input.question.trim()}
当前来源数：${input.sourceCount}

严格输出规则：
- 必须逐字保留下面九个 Markdown 二级标题，不增加其他标题、引言或结语。
- 每个章节只写 1 至 2 条项目符号；每条只能有一个句号，并在句号前标注真实证据编号。
- 不能由证据支持的内容写成“仍需核验[编号]”，不要补造 DOI、数据、统计结论或因果判断。
- 除标题外，任何一行都必须包含至少一个 [数字] 引用编号。

输出骨架：
${sections}

证据片段：
${input.evidenceContext}`;
}

export function classifyDeepResearchAnswer(input: {
  citationCount: number;
  citationAuditStatus: CitationAuditStatus;
  sectionCoverageStatus: string;
}): DeepResearchAnswerStatus {
  if (input.citationCount === 0) return 'no-evidence';
  if (input.citationAuditStatus !== 'pass' || input.sectionCoverageStatus !== 'pass') return 'incomplete';
  return 'complete';
}

export function hasSubstantiveDeepResearchEvidence(
  citations: Array<{ excerpt?: string; snippet?: string }>,
): boolean {
  return citations.some(citation => {
    const text = (citation.excerpt || citation.snippet || '').replace(/\s+/g, ' ').trim();
    return text.length >= 40;
  });
}

export function removeUncitedDeepResearchClaims(
  answer: string,
  coverage: CitationSectionCoverageResult,
): { answer: string; removedCount: number } {
  if (coverage.status !== 'missing-claim-citations' || coverage.uncitedClaims.length === 0) {
    return { answer, removedCount: 0 };
  }
  const byLine = new Map<number, string[]>();
  for (const claim of coverage.uncitedClaims) {
    byLine.set(claim.line, [...(byLine.get(claim.line) || []), claim.text]);
  }
  let removedCount = 0;
  const lines = answer.split(/\r?\n/).map((rawLine, index) => {
    let line = rawLine;
    for (const claim of byLine.get(index + 1) || []) {
      if (!line.includes(claim)) continue;
      line = line.replace(claim, '');
      removedCount += 1;
    }
    const trimmed = line.replace(/\s{2,}/g, ' ').trimEnd();
    return /^\s*[-*+]\s*$/.test(trimmed) ? '' : trimmed;
  });
  return {
    answer: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    removedCount,
  };
}
