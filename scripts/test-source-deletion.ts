import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { DELETE } from '../src/app/api/ingestion/sources/route';
import { ingestExtractedSource, deleteIngestionSources, SourceDeletionConflict, listIngestionSources, getIngestionSource, listReadySourceChunks } from '../src/lib/ingestion-store';
import type { SourceStoreFile } from '../src/lib/source-store/types';

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), 'lingbi-delete-test-'));
  process.env.SOURCE_STORE_PATH = path.join(root, 'sources.json');
  process.env.SOURCE_STORE_ADAPTER = 'local-json';
  process.env.ZVEC_STORE_PATH = path.join(root, 'zvec');
  process.env.ACCOUNT_CENTER_REQUIRE_AUTH = 'false';
  const request = (body: unknown) => new NextRequest('http://localhost/api/ingestion/sources', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    for (const [id, ownerMemberId, notebookId] of [
      ['mine', 'owner-a', 'book-a'], ['other-book', 'owner-a', 'book-b'],
      ['other-owner', 'owner-b', 'book-a'], ['guest', undefined, 'book-a'], ['busy', undefined, 'book-a'],
    ] as const) {
      await ingestExtractedSource({ id, ownerMemberId, notebookId, fileName: id+'.txt', fileType:'txt', title:id, content:'仅用于删除回归测试的文献内容。' });
    }
    assert.deepEqual(await deleteIngestionSources(['mine','other-book','other-owner'], { ownerMemberId:'owner-a',notebookId:'book-a' }), ['mine']);
    assert.equal(await getIngestionSource('mine',{ownerMemberId:'owner-a',notebookId:'book-a'}), undefined);
    assert.equal((await listReadySourceChunks({ownerMemberId:'owner-a',notebookId:'book-a'})).chunks.length, 0);
    assert.equal((await listIngestionSources({ownerMemberId:'owner-a',notebookId:'book-b'})).length, 1);
    assert.equal((await listIngestionSources({ownerMemberId:'owner-b',notebookId:'book-a'})).length, 1);
    assert.deepEqual(await deleteIngestionSources(['other-owner'],{notebookId:'book-a'}), [], 'guest cannot delete account-owned sources');
    const store = JSON.parse(await readFile(process.env.SOURCE_STORE_PATH, 'utf8')) as SourceStoreFile;
    store.sources.find(source=>source.id==='busy')!.status='running';
    await writeFile(process.env.SOURCE_STORE_PATH,JSON.stringify(store));
    await assert.rejects(deleteIngestionSources(['guest','busy'],{notebookId:'book-a'}),SourceDeletionConflict);
    assert.ok(await getIngestionSource('guest',{notebookId:'book-a'}),'batch conflict must preserve every source');
    assert.equal((await DELETE(request({ids:['busy'],notebookId:'book-a'}))).status,409);
    assert.equal((await DELETE(request({ids:['guest']}))).status,400);
    assert.equal((await DELETE(request({ids:[],notebookId:'book-a'}))).status,400);
    process.env.ACCOUNT_CENTER_REQUIRE_AUTH='true';
    assert.equal((await DELETE(request({ids:['guest'],notebookId:'book-a'}))).status,401);
    process.env.ACCOUNT_CENTER_REQUIRE_AUTH='false';
    const response=await DELETE(request({ids:['guest'],notebookId:'book-a'}));
    assert.equal(response.status,200);
    assert.deepEqual((await response.json()).deletedIds,['guest']);
    assert.deepEqual((await (await DELETE(request({ids:['guest'],notebookId:'book-a'}))).json()).deletedIds,[]);
    assert.equal(await getIngestionSource('guest',{notebookId:'book-a'}),undefined);
    const saved=JSON.parse(await readFile(process.env.SOURCE_STORE_PATH,'utf8')) as SourceStoreFile;
    assert.ok(!saved.sources.some(source=>['mine','guest'].includes(source.id)),'delete persists on disk');
    console.log('PASS: durable deletion, retrieval exclusion, notebook/account boundaries, batch atomicity, input validation, auth and idempotency');
  } finally { await rm(root,{recursive:true,force:true}); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});