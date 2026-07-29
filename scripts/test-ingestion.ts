import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildPostgresSourceStoreSchemaSql,
  buildPostgresReadyChunkSearchSql,
  buildReadySourceChunksResultFromSources,
  buildSourceStoreFromPostgresRows,
  getIngestionSource,
  ingestExtractedSource,
  listIngestionSources,
  listReadySourceChunks,
  resolvePostgresReadyChunkSearchMode,
  sourceStoreStatus,
  updateSourceMinerUStatus,
} from '../src/lib/ingestion-store';
import { querySourceChunks } from '../src/lib/vector-store';

function deterministicEmbedding(text: string): number[] {
  const lower = text.toLowerCase();
  if (lower.includes('留存') || lower.includes('retention')) return [1, 0, 0, 0];
  if (lower.includes('prompt') || lower.includes('studio')) return [0, 1, 0, 0];
  return [0, 0, 1, 0];
}

function withEnv<T>(patch: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function main() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-ingestion-test-'));
  process.env.SOURCE_STORE_PATH = path.join(tmpDir, 'sources.json');
  process.env.ZVEC_STORE_PATH = path.join(tmpDir, 'zvec');

  try {
    const status = sourceStoreStatus();
    assert.equal(status.provider, 'local-json');
    assert.equal(status.configured, true);
    assert(status.path);
    assert.match(status.path, /sources\.json$/);
    assert.equal(status.readyChunkSearch?.mode, 'ilike');
    assert.equal(status.readyChunkSearch?.env, 'POSTGRES_READY_CHUNK_SEARCH');

    const missingPostgres = withEnv({
      SOURCE_STORE_ADAPTER: 'postgres',
      DATABASE_URL: undefined,
    }, () => sourceStoreStatus());
    assert.equal(missingPostgres.provider, 'postgres');
    assert.equal(missingPostgres.configured, false);
    assert.equal(missingPostgres.databaseUrlConfigured, false);
    assert.equal(missingPostgres.table, 'lingbi_source_store');
    assert.equal(missingPostgres.normalizedSchema, true);
    assert.deepEqual(missingPostgres.tables, [
      'lingbi_source_store',
      'lingbi_sources',
      'lingbi_source_chunks',
      'lingbi_ingestion_stages',
    ]);

    const configuredPostgres = withEnv({
      SOURCE_STORE_ADAPTER: 'postgres',
      DATABASE_URL: 'postgres://user:pass@example.com:5432/lingbi',
      POSTGRES_READY_CHUNK_SEARCH: 'fts',
    }, () => sourceStoreStatus());
    assert.equal(configuredPostgres.provider, 'postgres');
    assert.equal(configuredPostgres.configured, true);
    assert.equal(configuredPostgres.databaseUrlConfigured, true);
    assert.equal(configuredPostgres.table, 'lingbi_source_store');
    assert.equal(configuredPostgres.normalizedSchema, true);
    assert.equal(configuredPostgres.readyChunkSearch?.mode, 'fts');
    assert(configuredPostgres.tables?.includes('lingbi_sources'));
    assert(configuredPostgres.tables?.includes('lingbi_source_chunks'));
    assert(configuredPostgres.tables?.includes('lingbi_ingestion_stages'));

    const schemaSql = buildPostgresSourceStoreSchemaSql().join('\n');
    assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS lingbi_sources/);
    assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS lingbi_source_chunks/);
    assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS lingbi_ingestion_stages/);
    assert.match(schemaSql, /REFERENCES lingbi_sources\(id\) ON DELETE CASCADE/);
    assert.match(schemaSql, /CREATE INDEX IF NOT EXISTS lingbi_source_chunks_fts_idx/);
    assert.match(schemaSql, /USING GIN/);
    assert.match(schemaSql, /to_tsvector\('simple'/);

    const defaultChunkSearch = buildPostgresReadyChunkSearchSql({
      query: 'Prompt retrieval 方法',
      paramIndex: 2,
      qualifier: 'c.',
      includeRank: true,
    });
    assert.equal(defaultChunkSearch.mode, 'ilike');
    assert.match(defaultChunkSearch.filter, /c\.text ILIKE ANY\(\$2::text\[\]\)/);
    assert.deepEqual(defaultChunkSearch.params, ['%prompt%', '%retrieval%', '%方法%']);
    assert.equal(defaultChunkSearch.selectRank, '');
    assert.equal(defaultChunkSearch.orderByPrefix, '');

    const ftsChunkSearch = buildPostgresReadyChunkSearchSql({
      query: 'Prompt retrieval 方法',
      paramIndex: 3,
      mode: 'fts',
      includeRank: true,
    });
    assert.equal(ftsChunkSearch.mode, 'fts');
    assert.match(ftsChunkSearch.filter, /to_tsvector\('simple'/);
    assert.match(ftsChunkSearch.filter, /plainto_tsquery\('simple', \$3\)/);
    assert.match(ftsChunkSearch.selectRank, /ts_rank\(to_tsvector\('simple'/);
    assert.equal(ftsChunkSearch.orderByPrefix, 'search_rank DESC, ');
    assert.deepEqual(ftsChunkSearch.params, ['prompt retrieval 方法']);

    const envFtsMode = withEnv({ POSTGRES_READY_CHUNK_SEARCH: 'fts' }, () => resolvePostgresReadyChunkSearchMode());
    const envDefaultMode = withEnv({ POSTGRES_READY_CHUNK_SEARCH: 'unknown' }, () => resolvePostgresReadyChunkSearchMode());
    assert.equal(envFtsMode, 'fts');
    assert.equal(envDefaultMode, 'ilike');

    const normalizedStore = buildSourceStoreFromPostgresRows({
      sources: [{
        id: 'pg-source',
        file_name: 'postgres.pdf',
        file_type: 'pdf',
        file_size: 2048,
        title: 'Postgres Normalized Source',
        short_name: 'PG. 2026',
        status: 'succeeded',
        chunk_count: 1,
        token_estimate: 32,
        vector_status: 'succeeded',
        vector_model: 'doubao-embedding-vision',
        vector_dimension: 4,
        vector_count: 1,
        created_at: '2026-06-16T00:00:00.000Z',
        updated_at: '2026-06-16T00:01:00.000Z',
        payload: {
          authors: ['Postgres Author'],
          year: 2025,
          keywords: ['evidence', 'retrieval'],
          abstract: 'A persisted abstract.',
          journal: 'Evidence Systems',
          doi: '10.1000/example',
          sections: [{
            title: '1 Introduction',
            level: 1,
            excerpt: 'Normalized payload metadata survives reconstruction.',
          }],
        },
      }],
      chunks: [{
        id: 'pg-source::chunk-1',
        source_id: 'pg-source',
        source_index: 0,
        chunk_index: 0,
        page: 7,
        paper_short_name: 'PG. 2026',
        source_title: 'Postgres Normalized Source',
        text: '规范化表可以恢复引用片段。',
        token_estimate: 16,
        payload: {},
      }],
      stages: [{
        source_id: 'pg-source',
        name: 'chunk',
        status: 'succeeded',
        started_at: '2026-06-16T00:00:30.000Z',
        completed_at: '2026-06-16T00:00:40.000Z',
        payload: {},
      }],
      updatedAt: '2026-06-16T00:01:00.000Z',
    });
    assert.equal(normalizedStore.sources.length, 1);
    assert.equal(normalizedStore.sources[0].id, 'pg-source');
    assert.equal(normalizedStore.sources[0].chunks[0].page, 7);
    assert.equal(normalizedStore.sources[0].stages[0].name, 'chunk');
    assert.equal(normalizedStore.sources[0].vectorIndex.model, 'doubao-embedding-vision');
    assert.deepEqual(normalizedStore.sources[0].authors, ['Postgres Author']);
    assert.equal(normalizedStore.sources[0].year, 2025);
    assert.deepEqual(normalizedStore.sources[0].keywords, ['evidence', 'retrieval']);
    assert.equal(normalizedStore.sources[0].abstract, 'A persisted abstract.');
    assert.equal(normalizedStore.sources[0].journal, 'Evidence Systems');
    assert.equal(normalizedStore.sources[0].doi, '10.1000/example');
    assert.equal(normalizedStore.sources[0].sections?.[0]?.title, '1 Introduction');
    const normalizedReadyChunks = buildReadySourceChunksResultFromSources(normalizedStore.sources, {
      identities: ['postgres.pdf'],
      query: '引用片段',
      topK: 1,
    });
    assert.equal(normalizedReadyChunks.persistedSourceCount, 1);
    assert.equal(normalizedReadyChunks.vectorIndexedSourceCount, 1);
    assert.equal(normalizedReadyChunks.chunks[0].id, 'pg-source::chunk-1');

    const indexed = await ingestExtractedSource({
      id: 'paper-retention',
      fileName: 'retention.pdf',
      fileType: 'pdf',
      fileSize: 1024,
      title: 'Retention Cohort Analysis',
      authors: ['Lingbi'],
      year: 2026,
      keywords: ['retention', 'cohort'],
      shortName: 'Lingbi. 2026',
      abstract: '用户留存研究。',
      journal: 'Product Analytics Review',
      doi: '10.1000/retention',
      content: '第三次有效使用是留存拐点。',
      rawContent: `摘要
用户留存研究。

一、研究方法
按用户第三次有效使用构建留存队列。

二、研究结果
第 7 页：第三次有效使用后，30 日留存率提升 41%。`,
    }, {
      embedder: async texts => texts.map(deterministicEmbedding),
    });

    assert.equal(indexed.status, 'succeeded');
    assert.equal(indexed.vectorIndex.status, 'succeeded');
    assert.equal(indexed.vectorIndex.dimension, 4);
    assert(indexed.chunkCount > 0, 'ingestion should persist chunks');
    assert(indexed.stages.some(stage => stage.name === 'chunk' && stage.status === 'succeeded'));
    assert(indexed.stages.some(stage => stage.name === 'index' && stage.status === 'succeeded'));
    assert(indexed.stages.some(stage => stage.name === 'mineru' && stage.status === 'pending'));
    assert.deepEqual(indexed.authors, ['Lingbi']);
    assert.equal(indexed.year, 2026);
    assert.deepEqual(indexed.keywords, ['retention', 'cohort']);
    assert.equal(indexed.abstract, '用户留存研究。');
    assert.equal(indexed.journal, 'Product Analytics Review');
    assert.equal(indexed.doi, '10.1000/retention');
    assert.deepEqual(indexed.sections?.map(section => section.title), ['摘要', '一、研究方法', '二、研究结果']);

    const readyChunks = await listReadySourceChunks();
    assert.equal(readyChunks.persistedSourceCount, 1);
    assert.equal(readyChunks.vectorIndexedSourceCount, 1);
    assert.equal(readyChunks.sourceIds[0], 'paper-retention');
    assert.equal(readyChunks.chunks[0].sourceId, 'paper-retention');

    const scopedReadyChunks = await listReadySourceChunks({ identities: ['retention.pdf'] });
    assert.equal(scopedReadyChunks.persistedSourceCount, 1);
    assert.equal(scopedReadyChunks.chunks[0].sourceId, 'paper-retention');

    const missingReadyChunks = await listReadySourceChunks({ identities: ['missing-source'] });
    assert.equal(missingReadyChunks.persistedSourceCount, 0);
    assert.equal(missingReadyChunks.chunks.length, 0);

    const listed = await listIngestionSources();
    assert.equal(listed.length, 1);
    const stored = await getIngestionSource('paper-retention');
    assert(stored, 'stored source should be retrievable by id');
    assert.equal(stored?.chunks[0]?.sourceId, 'paper-retention');

    const citations = await querySourceChunks([1, 0, 0, 0], { topK: 1 });
    assert.equal(citations[0].sourceId, 'paper-retention');
    assert.match(citations[0].excerpt, /30 日留存率提升 41%/);

    await updateSourceMinerUStatus('paper-retention', 'running');
    const mineruRunning = await getIngestionSource('paper-retention');
    assert.equal(mineruRunning?.mineru?.status, 'running');
    assert(mineruRunning?.stages.some(stage => stage.name === 'mineru' && stage.status === 'running'));

    await updateSourceMinerUStatus('paper-retention', 'succeeded', { figureCount: 3 });
    const mineruDone = await getIngestionSource('paper-retention');
    assert.equal(mineruDone?.mineru?.status, 'succeeded');
    assert.equal(mineruDone?.mineru?.figureCount, 3);
    assert(mineruDone?.stages.some(stage => stage.name === 'mineru' && stage.status === 'succeeded'));

    const keywordOnly = await ingestExtractedSource({
      id: 'paper-keyword-only',
      fileName: 'prompt-studio.md',
      fileType: 'md',
      title: 'Prompt Studio',
      shortName: 'Studio. 2026',
      content: '右侧按钮作为 prompt 触发器，中间区域呈现对话产物。',
    });

    assert.equal(keywordOnly.status, 'succeeded');
    assert.equal(keywordOnly.vectorIndex.status, 'not_configured');
    assert(keywordOnly.chunkCount > 0, 'source should still be usable for keyword retrieval without embeddings');

    const promptQueryChunks = await listReadySourceChunks({ query: 'prompt', topK: 1 });
    assert.equal(promptQueryChunks.persistedSourceCount, 1);
    assert.equal(promptQueryChunks.chunks.length, 1);
    assert.equal(promptQueryChunks.chunks[0].sourceId, 'paper-keyword-only');

    console.log(JSON.stringify({
      ok: true,
      checked: [
        'local source store status',
        'source store adapter status contract',
        'Postgres source store adapter normalized schema contract',
        'Postgres source chunk full-text index DDL contract',
        'Postgres ready chunk ilike/fts SQL contract',
        'source store health ready chunk search mode',
        'Postgres normalized rows read-model reconstruction',
        'paper metadata and section structure persistence',
        'ready source chunk query/topK contract',
        'ingestion stage transitions',
        'source chunks persisted',
        'optional embedding index to zvec',
        'zvec citation metadata query',
        'MinerU stage status persisted in source store',
        'keyword-only ingestion fallback',
      ],
      sourceCount: (await listIngestionSources()).length,
      indexedChunks: indexed.chunkCount,
      vectorIndex: indexed.vectorIndex.status,
    }, null, 2));
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
