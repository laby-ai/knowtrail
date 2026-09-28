import assert from 'node:assert/strict';
import { buildGroundedContext, buildSourceChunks, retrieveRelevantChunks } from '../src/lib/rag';

const sources = [
  {
    id: 'paper-retention',
    title: 'Retention Cohort Analysis',
    authors: ['Lingbi'],
    year: 2026,
    shortName: 'Lingbi. 2026',
    abstract: '用户留存研究，关注第 30 日留存率。',
    content: '第三次有效使用是留存拐点。报告 A 提到 30 日留存提升 41%。',
    rawContent: '第 7 页：第三次有效使用后，30 日留存率提升 41%，访谈中也出现相同模式。',
  },
  {
    id: 'paper-ui',
    title: 'Prompt Studio UI',
    authors: ['Studio'],
    year: 2025,
    shortName: 'Studio. 2025',
    abstract: '研究提示词按钮和中间对话区的协作体验。',
    content: '右侧按钮应该作为 prompt 触发器，中间区域呈现对话产物。',
  },
];

const chunks = buildSourceChunks(sources);
assert(chunks.length >= 2, 'source chunk builder should produce chunks');
assert(chunks.every(chunk => chunk.sourceId && chunk.id && chunk.text), 'chunks should keep stable source metadata');

const citations = retrieveRelevantChunks('30 日留存提升多少？', chunks, 3);
assert(citations.length > 0, 'retriever should return citations');
assert.equal(citations[0].sourceId, 'paper-retention', 'retriever should rank the retention paper first');
assert.match(citations[0].excerpt, /留存|41%/, 'citation excerpt should include relevant evidence');

const grounded = buildGroundedContext('右侧按钮在工作台里应该做什么？', sources, 2);
assert(grounded.promptContext.includes('sourceId:'), 'grounded prompt should expose source ids');
assert(grounded.promptContext.includes('chunkId:'), 'grounded prompt should expose chunk ids');
assert(grounded.citations.some(citation => citation.sourceId === 'paper-ui'), 'grounded context should retrieve UI prompt evidence');

const metadataOnly = {
  id: 'metadata-only', title: 'An unreviewed paper',
  content: 'This display text must not become evidence.',
  rawContent: 'This is not verified paper text.',
  literature: { evidenceScope: 'metadata' as const },
};
assert.deepEqual(buildSourceChunks([metadataOnly]), []);
assert.equal(buildGroundedContext('paper', [metadataOnly]).citations.length, 0);
const abstractOnly = buildSourceChunks([{
  ...metadataOnly,
  abstract: 'This abstract reports an observed association. '.repeat(100),
  literature: { evidenceScope: 'abstract' as const },
}]);
assert(abstractOnly.length > 1);
assert(abstractOnly.every(chunk => chunk.sourceTitle.includes('仅摘要')));
assert(abstractOnly.every(chunk => !chunk.text.includes('not verified') && !chunk.text.includes('display text')));
assert.deepEqual(buildSourceChunks([{ ...metadataOnly, literature: { evidenceScope: 'abstract' as const } }]), []);

console.log(JSON.stringify({
  ok: true,
  checked: [
    'source chunk metadata',
    'keyword retrieval ranking',
    'grounded citation snippets',
    'prompt context source/chunk ids',
  ],
  chunks: chunks.length,
  citations: citations.length,
}, null, 2));
