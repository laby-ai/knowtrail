import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ingestExtractedSource, listIngestionSources, getIngestionSource, listReadySourceChunks } from '../src/lib/ingestion-store';
async function main() {
  const root = await mkdtemp(path.join(tmpdir(), 'lingbi-notebook-isolation-'));
  process.env.SOURCE_STORE_PATH = path.join(root, 'sources.json');
  process.env.SOURCE_STORE_ADAPTER = 'local-json';
  process.env.ZVEC_STORE_PATH = path.join(root, 'zvec');
  try {
    for (const [id, ownerMemberId, notebookId] of [['a','owner-one','book-a'],['b','owner-one','book-b'],['c','owner-two','book-a']]) {
      await ingestExtractedSource({ id, ownerMemberId, notebookId, fileName: `${id}.txt`, fileType:'txt', title:id, content:`独立来源 ${id} 的研究内容。` });
    }
    const scope = { ownerMemberId:'owner-one', notebookId:'book-a' };
    assert.deepEqual((await listIngestionSources(scope)).map(s => s.id), ['a']);
    assert.equal(await getIngestionSource('b', scope), undefined);
    assert.equal(await getIngestionSource('c', scope), undefined);
    assert.deepEqual((await listReadySourceChunks(scope)).sourceIds, ['a']);
    assert.deepEqual(await listIngestionSources({...scope, notebookId:'new-empty'}), []);
    console.log('PASS: notebook source listing, detail lookup, retrieval, empty notebook and owner boundaries');
  } finally { await rm(root, { recursive:true, force:true }); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
