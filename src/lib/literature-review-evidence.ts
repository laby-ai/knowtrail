import { listIngestionSources } from './ingestion-store';
import { retrieveRelevantChunks, type RagSourceInput, type GroundedCitation } from './rag';
import type { GroundedRetrievalContext } from './grounded-retrieval';
import { auditCitationMarkers, type CitationAuditResult } from './citation-audit';

export class LiteratureReviewEvidenceError extends Error {
  constructor(public readonly status: 400 | 404 | 409 | 422, message: string) { super(message); }
}

export async function buildLiteratureReviewEvidence(
  question: string,
  selected: RagSourceInput[],
  scope: { ownerMemberId: string; notebookId: string },
): Promise<GroundedRetrievalContext> {
  if (selected.some(source => !source || typeof source.id !== 'string' || !source.id.trim())) {
    throw new LiteratureReviewEvidenceError(400, '所选资料编号不完整，请重新选择。');
  }
  const ids = [...new Set(selected.map(source => source.id!))];
  if (!ids.length || ids.length > 20) throw new LiteratureReviewEvidenceError(400, '文献综述需要选择1至20份本人资料。');
  const available = new Map((await listIngestionSources(scope)).map(source => [source.id, source]));
  const sources = ids.map(id => {
    const source = available.get(id);
    if (!source) throw new LiteratureReviewEvidenceError(404, '所选资料不属于当前文献本或已不可读，请重新读取资料。');
    if (source.status !== 'succeeded' || !source.chunks.length) throw new LiteratureReviewEvidenceError(409, '所选资料尚未全部解析完成，请等待或重新读取后再生成综述。');
    return source;
  });
  const citations = sources.map(source => retrieveRelevantChunks(question, source.chunks, 1)[0]);
  const promptContext = [
    `本轮已选${sources.length}份来源，逐篇提供各1个相关片段。以下是证据片段，不是全文；不得声称已读全文或已完成全网检索。`,
    ...citations.map((citation, i) => `[${i + 1}] ${citation.paperShortName} - ${citation.sourceTitle}${citation.page ? `, 页码: ${citation.page}` : ''}\nsourceId: ${citation.sourceId}\nchunkId: ${citation.chunkId}\n摘录:\n${citation.excerpt}`),
  ].join('\n\n---\n\n');
  if (promptContext.length > 9000) throw new LiteratureReviewEvidenceError(422, '所选资料的综述证据超出本次读取范围，请减少来源后分批综述。未省略任何来源来生成结果。');
  return {
    chunks: sources.flatMap(source => source.chunks), citations, promptContext,
    retrievalMode: 'persisted-keyword', persistedSourceCount: sources.length,
    vectorIndexedSourceCount: sources.filter(source => source.vectorIndex.status === 'succeeded').length,
    degraded: false,
    reason: `已逐篇读取${sources.length}份所选来源的相关片段；这是片段综述，不代表核验全文。`,
  };
}

export function auditLiteratureReviewCoverage(answer: string, citations: GroundedCitation[]): CitationAuditResult {
  const audit = auditCitationMarkers(answer, citations);
  if (audit.status === 'invalid-markers' || !citations.length) return audit;
  const body: string[] = [];
  let referencesLevel = 0;
  for (const line of answer.split('\n')) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (heading) {
      if (referencesLevel && heading[1].length <= referencesLevel) referencesLevel = 0;
      if (/^(参考文献|参考资料|引用来源|references|bibliography)[：:]?$/i.test(heading[2].trim())) {
        referencesLevel = heading[1].length;
        continue;
      }
    }
    if (!referencesLevel) body.push(line);
  }
  const coverage = auditCitationMarkers(body.join('\n'), citations);
  if (coverage.uncitedNumbers.length) return {
    ...coverage, status: 'missing-markers',
    sourceCoverage: { covered: citations.length - coverage.uncitedNumbers.length, total: citations.length },
    warning: `正文未涵盖全部${citations.length}份所选来源，缺少${coverage.uncitedNumbers.map(n => `[${n}]`).join('、')}的引用。当前结果不能视作全部所选资料的综述，请按实际范围核对；需要时可补充范围后继续。`,
  };
  return { ...coverage, sourceCoverage: { covered: citations.length, total: citations.length } };
}
