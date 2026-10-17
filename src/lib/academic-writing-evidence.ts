import { listIngestionSources } from './ingestion-store';
import type { GroundedRetrievalContext } from './grounded-retrieval';
import { auditCitationMarkers, type CitationAuditResult } from './citation-audit';
import type { GroundedCitation } from './rag';

function numbers(text: string): string[] {
  return [...new Set(text.normalize('NFKC').replaceAll('−', '-').match(/[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?%?/g) || [])];
}

export class AcademicWritingEvidenceError extends Error {
  constructor(public readonly status: 404 | 409 | 422, message: string) { super(message); }
}

export async function expandAcademicWritingEvidence(
  grounded: GroundedRetrievalContext,
  scope: { ownerMemberId: string; notebookId: string },
): Promise<GroundedRetrievalContext & { writingNumbers: string[] }> {
  if (!grounded.citations.length) throw new AcademicWritingEvidenceError(422, '所选资料没有可用文字片段，请检查解析结果或补充写作材料。');
  const sources = new Map((await listIngestionSources(scope)).map(source => [source.id, source]));
  const texts: string[] = [];
  const sections = grounded.citations.map((citation, index) => {
    const source = sources.get(citation.sourceId);
    if (!source) throw new AcademicWritingEvidenceError(404, '写作来源不属于当前文献本或已不可读，请重新选择。');
    const chunk = source.chunks.find(item => item.id === citation.chunkId && item.sourceId === source.id);
    if (source.status !== 'succeeded' || !chunk?.text.trim()) throw new AcademicWritingEvidenceError(409, '写作原文片段尚未就绪或已经变化，请重新读取资料。');
    texts.push(chunk.text);
    return `[${index + 1}] ${chunk.paperShortName} - ${chunk.sourceTitle}${chunk.page ? `, 页码: ${chunk.page}` : ''}\nsourceId: ${source.id}\nchunkId: ${chunk.id}\n原文片段:\n${chunk.text}`;
  });
  const promptContext = [`以下为本轮检索命中的${sections.length}个完整文字片段，引用编号与证据卡片一致。完整片段不是论文全文，未出现的信息不能补写。`, ...sections].join('\n\n---\n\n');
  if (promptContext.length > 9000) throw new AcademicWritingEvidenceError(422, '写作原文片段超出本次读取范围，请收窄写作目标或资料范围后重试。未截断片段来生成正文。');
  return { ...grounded, promptContext, writingNumbers: numbers(texts.join('\n')), reason: `${grounded.reason || ''} 本轮写作使用${sections.length}个完整检索片段，不代表读取全文。`.trim() };
}

export function auditAcademicWriting(answer: string, citations: GroundedCitation[], request: string, writingNumbers: string[]): CitationAuditResult {
  const audit = auditCitationMarkers(answer, citations);
  if (!/(?:保留|保持)[\s\S]{0,16}(?:全部|所有)(?:数字|数值)/.test(request) || !writingNumbers.length) return audit;
  const present = new Set(numbers(answer.replace(/\[\d{1,3}\]/g, '')));
  const missing = writingNumbers.filter(value => !present.has(value));
  if (!missing.length) return audit;
  return {
    ...audit,
    status: audit.status === 'pass' || audit.status === 'none' ? 'needs-review' : audit.status,
    numericPreservation: { checked: writingNumbers.length, missing },
    warning: [audit.warning, `原文片段中这些数字未出现在正文：${missing.join('、')}。你要求保留全部数字，请核对后再使用。该检查只比较数字写法，不代替单位与语义核验。`].filter(Boolean).join('；'),
  };
}
