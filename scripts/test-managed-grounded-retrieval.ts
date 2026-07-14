import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { buildGroundedRetrievalContext } from '../src/lib/grounded-retrieval';
import { ingestExtractedSource } from '../src/lib/ingestion-store';

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  return address.port;
}

async function main() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-managed-retrieval-'));
  process.env.SOURCE_STORE_PATH = path.join(tmpDir, 'sources.json');
  process.env.ZVEC_STORE_PATH = path.join(tmpDir, 'zvec');

  let embeddingCalls = 0;
  const embeddingServer = http.createServer(async (request, response) => {
    for await (const _chunk of request) void _chunk;
    embeddingCalls += 1;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data: { object: 'embedding', embedding: [1, 0, 0, 0] } }));
  });
  const embeddingPort = await listen(embeddingServer);

  const resolverServer = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      code: 0,
      data: {
        model: 'doubao-embedding-vision-251215',
        modelType: 5,
        apiKey: 'test-only-managed-retrieval-key',
        url: `http://127.0.0.1:${embeddingPort}/api/v3`,
      },
    }));
  });
  const resolverPort = await listen(resolverServer);

  process.env.ZHIQI_MODEL_RESOLVE_URL = `http://127.0.0.1:${resolverPort}/admin-api/ai/model/resolve`;
  process.env.ALLOW_INSECURE_API_BASE = 'true';
  process.env.ALLOW_PRIVATE_API_BASE = 'true';
  delete process.env.OPENAI_COMPAT_API_BASE;
  delete process.env.OPENAI_COMPAT_API_KEY;
  delete process.env.ARK_API_BASE;
  delete process.env.ARK_API_KEY;

  try {
    const ingested = await ingestExtractedSource({
      id: 'managed-vector-source',
      fileName: 'managed.md',
      fileType: 'md',
      title: 'Managed Vector Source',
      shortName: 'Managed. 2026',
      content: '统一模型管理应驱动真实向量检索。',
    });

    assert.equal(ingested.vectorIndex.status, 'succeeded');

    const grounded = await buildGroundedRetrievalContext('如何验证统一向量检索？', []);

    assert.equal(grounded.retrievalMode, 'persisted-vector');
    assert.equal(grounded.degraded, false);
    assert.equal(grounded.citations[0]?.sourceId, 'managed-vector-source');
    assert.equal(embeddingCalls, 2);
  } finally {
    delete process.env.ZHIQI_MODEL_RESOLVE_URL;
    delete process.env.ALLOW_INSECURE_API_BASE;
    delete process.env.ALLOW_PRIVATE_API_BASE;
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    await Promise.all([
      new Promise<void>(resolve => embeddingServer.close(() => resolve())),
      new Promise<void>(resolve => resolverServer.close(() => resolve())),
    ]);
  }

  console.log(JSON.stringify({
    ok: true,
    checked: [
      'managed paper_embedding indexes ingested sources',
      'managed paper_embedding enables the real grounded vector retrieval path',
    ],
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
