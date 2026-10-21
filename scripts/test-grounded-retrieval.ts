import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildGroundedRetrievalContext } from '../src/lib/grounded-retrieval';
import { ingestExtractedSource, listReadySourceChunks } from '../src/lib/ingestion-store';
import { upsertSourceChunks } from '../src/lib/vector-store';

function deterministicEmbedding(text: string): number[] {
  const lower = text.toLowerCase();
  if (lower.includes('留存') || lower.includes('retention') || lower.includes('30 日')) return [1, 0, 0, 0];
  if (lower.includes('prompt') || lower.includes('studio') || lower.includes('右侧按钮')) return [0, 1, 0, 0];
  return [0, 0, 1, 0];
}

async function main() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-grounded-retrieval-test-'));
  process.env.SOURCE_STORE_PATH = path.join(tmpDir, 'sources.json');
  process.env.ZVEC_STORE_PATH = path.join(tmpDir, 'zvec');

  try {
    await ingestExtractedSource({
      id: 'paper-retention',
      fileName: 'retention.pdf',
      fileType: 'pdf',
      title: 'Retention Cohort Analysis',
      shortName: 'Lingbi. 2026',
      content: '第 7 页：第三次有效使用后，30 日留存率提升 41%。',
    }, {
      embedder: async texts => texts.map(deterministicEmbedding),
    });

    await ingestExtractedSource({
      id: 'paper-studio',
      fileName: 'studio.md',
      fileType: 'md',
      title: 'Prompt Studio',
      shortName: 'Studio. 2026',
      content: '右侧按钮作为 prompt 触发器，中间区域呈现对话产物。',
    });

    const vectorGrounded = await buildGroundedRetrievalContext('30 日留存提升多少？', [], undefined, {
      embedder: async texts => texts.map(deterministicEmbedding),
    });
    assert.equal(vectorGrounded.retrievalMode, 'persisted-vector');
    assert.equal(vectorGrounded.degraded, false);
    assert.match(vectorGrounded.reason || '', /向量索引/);
    assert.equal(vectorGrounded.citations[0].sourceId, 'paper-retention');
    assert.match(vectorGrounded.promptContext, /chunkId: paper-retention::chunk-1/);

    const keywordGrounded = await buildGroundedRetrievalContext('右侧按钮在 Studio 里做什么？', []);
    assert.equal(keywordGrounded.retrievalMode, 'persisted-keyword');
    assert.equal(keywordGrounded.degraded, true);
    assert.match(keywordGrounded.reason || '', /向量模型|持久化文本片段/);
    assert.equal(keywordGrounded.citations[0].sourceId, 'paper-studio');
    assert.match(keywordGrounded.citations[0].excerpt, /prompt 触发器/);

    const requestFallback = await buildGroundedRetrievalContext('方法对比是什么？', [{
      id: 'request-only',
      title: 'Request Only Source',
      shortName: 'Req. 2026',
      content: '方法对比显示，A 方法在成本上低于 B 方法。',
    }]);
    assert.equal(requestFallback.retrievalMode, 'request-keyword');
    assert.equal(requestFallback.degraded, true);
    assert.match(requestFallback.reason || '', /当前请求携带/);
    assert.equal(requestFallback.citations[0].sourceId, 'request-only');

    const scopedFallback = await buildGroundedRetrievalContext('30 日留存提升多少？', [{
      id: 'paper-retention',
      title: 'Retention Cohort Analysis',
    }]);
    assert.notEqual(scopedFallback.citations[0]?.sourceId, 'paper-studio', 'selected source scope should exclude unrelated persisted sources');

    const owner = { ownerMemberId: 'vector-owner', notebookId: 'vector-notebook' };
    const canonicalEmbedding = async (texts: string[]) => texts.map(text => text.includes('FACT_B') ? [1, 0, 0, 0]
      : text.includes('FACT_A') ? [0.99, 0.1, 0, 0] : [0, 0, 1, 0]);
    const canonicalSources = [
      { id: 'canonical-a', ...owner, rawContent: ['filterkey '.repeat(100), 'Unrelated background. '.repeat(60),
        'Different terminology and context. '.repeat(25) + 'FACT_A: approximately 6.5 m, with its original qualification.'].join('\n\n') },
      { id: 'canonical-b', ...owner, rawContent: 'Other terminology. '.repeat(35) + 'FACT_B: 2.4 m, not an exact comparison.' },
      { id: 'foreign-owner', ...owner, ownerMemberId: 'another-owner', rawContent: 'FACT_B FOREIGN_OWNER_BODY' },
      { id: 'foreign-notebook', ...owner, notebookId: 'another-notebook', rawContent: 'FACT_B FOREIGN_NOTEBOOK_BODY' },
      { id: 'unselected-source', ...owner, rawContent: 'FACT_B UNSELECTED_BODY' },
    ];
    for (const input of canonicalSources) {
      const saved = await ingestExtractedSource({ ...input, title: 'Optical instrument', fileName: input.id + '.txt', fileType: 'txt' }, { embedder: canonicalEmbedding });
      assert.equal(saved.vectorIndex.status, 'succeeded');
    }
    const keyword = await listReadySourceChunks({ ...owner, identities: ['canonical-a', 'canonical-b'], query: 'filterkey', topK: 40 });
    assert(!keyword.chunks.some(chunk => chunk.text.includes('FACT_A')));
    assert(!keyword.sourceIds.includes('canonical-b'), 'Fixture must exclude the second source from literal keyword candidates');
    const current = await listReadySourceChunks({ ...owner, identities: ['canonical-a'] });
    const currentHit = current.chunks.find(chunk => chunk.text.includes('FACT_A'));
    assert(currentHit);
    await upsertSourceChunks([
      { ...currentHit, id: 'canonical-a::obsolete', text: 'OBSOLETE_VECTOR_ONLY_BODY', embedding: [1, 0, 0, 0] },
      { ...currentHit, text: 'STALE_VECTOR_PREVIEW', sourceTitle: 'Obsolete title', chunkIndex: 99, page: 999, embedding: [0.99, 0.1, 0, 0] },
    ]);
    const singleHit = await buildGroundedRetrievalContext('filterkey', [{ id: 'canonical-a' }], undefined,
      { ...owner, topK: 1, embedder: async () => [[1, 0, 0, 0]] });
    assert(singleHit.promptContext.includes('FACT_A: approximately 6.5 m'), 'Full current vector hit text must not depend on the keyword candidate subset');
    assert(!/OBSOLETE_VECTOR_ONLY_BODY|STALE_VECTOR_PREVIEW/.test(JSON.stringify(singleHit)), 'Deleted chunks and stale index text cannot become model or card evidence');
    assert.equal(singleHit.citations[0].excerpt, currentHit.text.slice(0, 320));
    assert.equal(singleHit.citations[0].chunkIndex, currentHit.chunkIndex);
    assert.equal(singleHit.citations[0].page, currentHit.page);
    const selectedPair = await buildGroundedRetrievalContext('filterkey', canonicalSources.slice(0, 4).map(source => ({ id: source.id })), undefined,
      { ...owner, topK: 2, embedder: async () => [[1, 0, 0, 0]] });
    assert.equal(selectedPair.retrievalMode, 'persisted-vector');
    assert(selectedPair.citations.some(citation => citation.sourceId === 'canonical-b'), 'Selected semantic sources remain eligible without a literal term match');
    assert(!/FOREIGN_OWNER_BODY|FOREIGN_NOTEBOOK_BODY|UNSELECTED_BODY/.test(selectedPair.promptContext), 'Canonical hit loading must keep owner/notebook/selection scope');

    console.log(JSON.stringify({
      ok: true,
      checked: [
        'chat retrieval prefers persisted zvec when query embeddings are available',
        'chat retrieval falls back to persisted keyword chunks without embedding config',
        'chat retrieval falls back to request papers when selected sources are not persisted',
        'retrieval metadata exposes degraded and reason for UI/user-facing fallback copy',
        'selected source scope filters persisted retrieval',
        'native vector hits use full current owned text independently of keyword candidates',
      ],
      vectorMode: vectorGrounded.retrievalMode,
      keywordMode: keywordGrounded.retrievalMode,
      fallbackMode: requestFallback.retrievalMode,
    }, null, 2));
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
