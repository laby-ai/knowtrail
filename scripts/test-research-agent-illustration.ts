import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rename, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PathLike } from 'node:fs';

async function main() {
  const fixture=await mkdtemp(path.join(tmpdir(),'agent-illustration-'));
  Object.assign(process.env,{STUDIO_DOCUMENT_STORE_DIR:path.join(fixture,'documents'),SCIENTIFIC_ILLUSTRATION_STORE_DIR:path.join(fixture,'images'),SOURCE_STORE_PATH:path.join(fixture,'sources.json'),SOURCE_STORE_ADAPTER:'local-json',ZVEC_STORE_PATH:path.join(fixture,'zvec'),PAPER_HOST_SESSION_VERIFY_URL:'https://sms-fixture.invalid/session?provider=knowtrail',DASHSCOPE_API_KEY:'fixture-image-key',DASHSCOPE_IMAGE_API_BASE:'https://image-gateway-fixture.invalid/api/v1',DASHSCOPE_IMAGE_MODEL:'qwen-image-2.0',OPENAI_COMPAT_API_KEY:'',ARK_API_KEY:'',OPENAI_API_KEY:'',REAL_SERVICE_FETCH_RETRIES:'1'});
  const app=createRequire(`${process.cwd()}/package.json`);
  const fsp=app('node:fs/promises') as typeof import('node:fs/promises');
  const originalRename=fsp.rename;
  let abortDuringStore: AbortController | null=null;
  Object.defineProperty(fsp,'rename',{value:async(from:PathLike,to:PathLike)=>{
    await originalRename(from,to);
    if(abortDuringStore&&String(to).startsWith(path.join(fixture,'images')+path.sep)&&String(to).endsWith('.json'))abortDuringStore.abort();
  }});
  const {NextRequest}=app('next/server');
  const route=app('./src/app/api/ai/scientific-illustration/route.ts');
  const imageRoute=app('./src/app/api/ai/scientific-illustration/[id]/route.ts');
  const artifacts=app('./src/app/api/studio/artifacts/route.ts');
  const store=app('./src/lib/private-notebook-document.ts');
  const {ingestExtractedSource}=app('./src/lib/ingestion-store.ts');
  const {readGeneratedIllustration,IllustrationSaveError,isIllustrationInput}=app('./src/lib/research-agent-illustration.ts');
  const {isResearchToolCall}=app('./src/lib/research-agent-contract.ts');
  const scope={ownerMemberId:`paper-host:paper-user-${'a'.repeat(32)}`,notebookId:'agent-illustration-fixture'};
  const directory=store.notebookDocumentDirectory(scope,'scientific-illustration');
  const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  let imageCalls=0;let failSave=false;
  globalThis.fetch=async(input,init)=>{
    const url=String(input);
    if(url.includes('sms-fixture.invalid')){
      const cookie=new Headers(init?.headers).get('cookie')||'';
      const who=cookie.includes('fixture-valid-a')?'a':cookie.includes('fixture-valid-b')?'b':null;
      return who?Response.json({data:{authenticated:true,provider:'knowtrail',workspaceKey:'paper-user-'+who.repeat(32),capabilities:['verified-sms-session']}}):Response.json({},{status:401});
    }
    if(url==='https://image-fixture.invalid/pixel.png')return new Response(pixel,{headers:{'Content-Type':'image/png'}});
    assert(url.includes('image-gateway-fixture.invalid')&&url.endsWith('/generation'),'No real paid network');
    const body=String(init?.body);assert(body.includes('原文唯一标记')&&!body.includes('FORGED-CLIENT-CONTENT'));
    imageCalls++;
    if(failSave){await rename(directory,directory+'-backup');await writeFile(directory,'owned fixture publication failure');}
    return Response.json({output:{choices:[{message:{content:[{image:'https://image-fixture.invalid/pixel.png'}]}}]}});
  };
  try {
    await ingestExtractedSource({id:'illustration-source',...scope,title:'软件验收模拟原文',fileName:'fixture.txt',fileType:'txt',content:'原文唯一标记：导入、检查时间戳、剔除缺失、人工核对；12条剔除2条保留10条，仅软件验收，不是科研结果。'});
    const input={purpose:'为本人模拟资料生成四步流程示意图，不作科研外推。',figureKind:'workflow',aspectRatio:'16:9',requiredLabels:['导入','检查时间戳','剔除缺失','人工核对']};
    const runId='11111111-1111-4111-8111-111111111111';
    const request=(url:string,method='GET',body?:unknown,who='a',signal?:AbortSignal)=>new NextRequest('https://fixture.invalid/knowtrail'+url,{method,headers:{...(who?{cookie:`userId=fixture; token=fixture-valid-${who}`} :{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal});
    const postBody={...input,runId,notebookId:scope.notebookId,papers:[{id:'illustration-source',title:'伪造标题',content:'FORGED-CLIENT-CONTENT'}],persistArtifact:true,expectedRevision:null as string|null};
    const response=await route.POST(request('/api/ai/scientific-illustration','POST',postBody));
    assert.equal(response.status,200);
    const payload=await response.json();const signal=new AbortController().signal;
    const saved=await readGeneratedIllustration(Response.json(payload),runId,input,null,signal);
    assert.equal(imageCalls,1);assert.equal(saved.data.result.reviewRequired,true);
    const reference={...input,sourceIds:['illustration-source'],runId,revision:saved.revision,imageId:saved.data.result.id,status:'incomplete'};
    const call={id:'illustration-1',plugin:'scientific-illustration',query:input.purpose,status:'ready',illustration:reference};
    assert(isResearchToolCall(call));assert(!isResearchToolCall({...call,plugin:'report'}));
    assert(!isResearchToolCall({...call,illustration:{...reference,status:'complete'}}));
    assert(!isIllustrationInput({...input,ownerMemberId:'forged'}));
    assert(!isIllustrationInput({...input,requiredLabels:Array(7).fill('多余标签')}));
    assert(!isIllustrationInput({...input,figureKind:'statistical-chart'}));
    await assert.rejects(readGeneratedIllustration(Response.json(payload),runId,{...input,aspectRatio:'1:1'},null,signal));
    const imagePath=`/api/ai/scientific-illustration/${reference.imageId}?notebookId=${scope.notebookId}&download=1`;
    const getImage=(who='a',book=scope.notebookId)=>imageRoute.GET(request(imagePath.replace(scope.notebookId,book),'GET',undefined,who),{params:Promise.resolve({id:reference.imageId})});
    const download=await getImage();assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),pixel);
    assert.equal(download.headers.get('Cache-Control'),'private, no-store');assert.match(download.headers.get('Content-Disposition')||'',/attachment/);
    assert.equal((await getImage('')).status,401);assert.equal((await getImage('b')).status,403);assert.equal((await getImage('a','another-fixture')).status,404);
    const replay=await route.POST(request('/api/ai/scientific-illustration','POST',postBody));assert.equal(replay.status,200);assert.equal(imageCalls,1,'Same run reuses its saved image');
    assert.equal((await route.POST(request('/api/ai/scientific-illustration','POST',{...postBody,runId:runId.replace(/1$/,'6'),expectedRevision:'0'.repeat(64)}))).status,409);assert.equal(imageCalls,1);
    const nextInput={...input,purpose:'另一份方法示意图，仍只用于软件验收。',figureKind:'method-diagram'};
    const newer=await (await route.POST(request('/api/ai/scientific-illustration','POST',{...postBody,...nextInput,runId:runId.replace(/1$/,'2'),expectedRevision:saved.revision}))).json();
    assert.equal(newer.document.data.form.purpose,nextInput.purpose);
    const old=await artifacts.GET(request(`/api/studio/artifacts?kind=scientific-illustration&notebookId=${scope.notebookId}&revision=${saved.revision}`));
    assert.deepEqual((await old.json()).document,saved);
    failSave=true;
    const failed=await route.POST(request('/api/ai/scientific-illustration','POST',{...postBody,runId:runId.replace(/1$/,'3'),expectedRevision:newer.document.revision}));
    const unsaved=await failed.json();assert(unsaved.unsavedDocument&&!unsaved.document);
    await readGeneratedIllustration(Response.json(unsaved),runId.replace(/1$/,'3'),input,newer.document.revision,signal).then(()=>assert.fail('Unsaved file is not a durable conversation reference'),(error:unknown)=>assert(error instanceof IllustrationSaveError));
    await unlink(directory);await rename(directory+'-backup',directory);failSave=false;
    const before=imageCalls;
    const put={notebookId:scope.notebookId,data:unsaved.unsavedDocument,expectedRevision:newer.document.revision};
    const retried=await artifacts.PUT(request('/api/studio/artifacts?kind=scientific-illustration','PUT',put));assert.equal(retried.status,200);assert.equal(imageCalls,before);
    const current=(await retried.json()).document;
    assert.equal((await artifacts.PUT(request('/api/studio/artifacts?kind=scientific-illustration','PUT',{...put,data:{...put.data,form:{...put.data.form,purpose:'不同表单'}},expectedRevision:saved.revision}))).status,409);
    await ingestExtractedSource({id:'long-source',...scope,title:'专用超限原文',fileName:'long.txt',fileType:'txt',content:'原文唯一标记。'.repeat(3000)});
    const tooLong=await route.POST(request('/api/ai/scientific-illustration','POST',{...postBody,papers:[{id:'long-source',title:'超限原文'}],runId:runId.replace(/1$/,'4'),expectedRevision:current.revision}));assert.equal(tooLong.status,422);assert.equal(imageCalls,before);
    abortDuringStore=new AbortController();
    const stopped=await route.POST(request('/api/ai/scientific-illustration','POST',{...postBody,runId:runId.replace(/1$/,'5'),expectedRevision:current.revision},'a',abortDuringStore.signal));
    console.log(JSON.stringify({abortDuringMetadataSaveObserved:abortDuringStore.signal.aborted,responseStatus:stopped.status,pixelFixtureIsNotScientificQuality:true}));
    assert.equal(stopped.status,499,'A stop during private image-file saving must not publish a later document');
    assert.equal((await store.readNotebookDocument(scope,'scientific-illustration')).revision,current.revision);
    console.log(JSON.stringify({ok:true,actualGeneratorAndPrivateFile:true,canonicalEvidence:true,exactByteDownload:true,immutableVersions:true,saveOnlyRetryCallsUnchanged:true,conflictsPreserved:true,abortAfterImageStoreDidNotPublish:true,fixtureImageCalls:imageCalls,paidCalls:0,scientificQualityAccepted:false}));
  } finally {Object.defineProperty(fsp,'rename',{value:originalRename});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
