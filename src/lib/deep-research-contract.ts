import type { CitationAuditStatus } from '@/lib/citation-audit';

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
- 证据不足时明确写入“还需要核验”，不要补写不存在的 DOI、引用量、期刊等级或统计结果。

必须按以下 Markdown 二级标题完整输出：
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
