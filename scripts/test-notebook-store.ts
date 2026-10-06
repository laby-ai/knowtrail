import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { saveNotebookMetadata, listNotebooks } from '../src/lib/notebook-store';
import { ingestExtractedSource } from '../src/lib/ingestion-store';
import { GET, POST } from '../src/app/api/notebooks/route';
import { NextRequest } from 'next/server';
async function main() {
 const root = await mkdtemp(path.join(tmpdir(), 'lingbi-notebooks-'));
 process.env.NOTEBOOK_STORE_PATH = path.join(root,'notebooks'); process.env.SOURCE_STORE_PATH = path.join(root,'sources.json'); process.env.SOURCE_STORE_ADAPTER='local-json'; process.env.ZVEC_STORE_PATH=path.join(root,'zvec');
 try {
  assert.deepEqual(await listNotebooks('a'),[]);
  await saveNotebookMetadata('a',[{id:'book-a',title:'真实课题'}]);
  await saveNotebookMetadata('b',[{id:'book-a',title:'另一账号'}]);
  await saveNotebookMetadata('a',[{id:'book-a',title:'缓存旧标题'}],true);
  await ingestExtractedSource({id:'source-a',ownerMemberId:'a',notebookId:'book-a',title:'测试来源',fileName:'a.txt',fileType:'txt',content:'隔离回归测试专用文本。'});
  assert.equal((await listNotebooks('a'))[0].title,'真实课题'); assert.equal((await listNotebooks('a'))[0].sourceCount,1);
  assert.equal((await listNotebooks('b'))[0].sourceCount,0); assert.deepEqual(await listNotebooks(),[]);
  process.env.ACCOUNT_CENTER_REQUIRE_AUTH='true';assert.equal((await GET(new NextRequest('http://localhost/api/notebooks'))).status,401);
  process.env.ACCOUNT_CENTER_REQUIRE_AUTH='false';
  const post=(body:unknown)=>POST(new NextRequest('http://localhost/api/notebooks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
  assert.equal((await post({notebooks:[{id:'../bad',title:'bad'}]})).status,400);
  assert.equal((await post({notebooks:[{id:'guest-book',title:'接口创建'}]})).status,200);
  const response=await GET(new NextRequest('http://localhost/api/notebooks'));assert.equal((await response.json()).notebooks[0].title,'接口创建');
  console.log('PASS: empty state, durable metadata, account isolation, real source count, import idempotency, API creation and auth');
 } finally {await rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});