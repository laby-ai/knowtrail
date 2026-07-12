import assert from 'node:assert/strict';
import type { StoredSourceRecord } from '../src/lib/source-store/types';
import { IngestionRetryError, retryIngestionSource } from '../src/lib/ingestion-retry';

function source(overrides: Partial<StoredSourceRecord> = {}): StoredSourceRecord {
  return {
    id: 'paper-failed',
    ownerMemberId: 'member-1',
    notebookId: 'notebook-1',
    fileName: 'evidence.md',
    fileType: 'md',
    title: 'Evidence Paper',
    shortName: 'Evidence. 2026',
    storageKey: '/uploads/evidence.md',
    status: 'failed',
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:01.000Z',
    stages: [],
    chunks: [],
    chunkCount: 0,
    tokenEstimate: 0,
    vectorIndex: { status: 'failed', updatedAt: '2026-07-12T00:00:01.000Z' },
    ...overrides,
  };
}

async function expectRetryError(input: StoredSourceRecord, code: IngestionRetryError['code']) {
  await assert.rejects(
    retryIngestionSource(input, {}, {
      retrieve: async () => Buffer.from('unused'),
      extract: async () => 'unused',
      ingest: async () => input,
    }),
    (error: unknown) => error instanceof IngestionRetryError && error.code === code,
  );
}

async function main() {
  let ingestedId = '';
  let ingestedOwner = '';
  let ingestedCreatedAt = '';
  const result = await retryIngestionSource(source(), {}, {
    retrieve: async key => {
      assert.equal(key, '/uploads/evidence.md');
      return Buffer.from('原始文献');
    },
    extract: async (_path, ext) => {
      assert.equal(ext, 'md');
      return '第一段证据。\n\n第二段证据。';
    },
    ingest: async input => {
      ingestedId = input.id;
      ingestedOwner = input.ownerMemberId || '';
      ingestedCreatedAt = input.createdAt || '';
      assert.match(input.rawContent || '', /第二段证据/);
      return source({ status: 'succeeded', chunkCount: 2 });
    },
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(ingestedId, 'paper-failed', 'retry must preserve the original paper id');
  assert.equal(ingestedOwner, 'member-1', 'retry must preserve source ownership');
  assert.equal(ingestedCreatedAt, '2026-07-12T00:00:00.000Z', 'retry must preserve source ordering');

  await expectRetryError(source({ status: 'succeeded' }), 'not_retryable');
  await expectRetryError(source({ storageKey: undefined, fileUrl: undefined }), 'source_unavailable');
  await assert.rejects(
    retryIngestionSource(source(), {}, {
      retrieve: async () => Buffer.from('empty'),
      extract: async () => '   ',
      ingest: async () => source(),
    }),
    (error: unknown) => error instanceof IngestionRetryError && error.code === 'empty_content',
  );

  console.log(JSON.stringify({
    ok: true,
    checked: ['same paper id', 'owner scope preservation', 'created time preservation', 'status gate', 'missing source', 'empty extraction'],
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
