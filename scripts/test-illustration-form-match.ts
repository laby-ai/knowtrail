import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function main() {
  const fixture=await mkdtemp(path.join(tmpdir(),'illustration-form-'));
  Object.assign(process.env,{STUDIO_DOCUMENT_STORE_DIR:path.join(fixture,'documents'),SCIENTIFIC_ILLUSTRATION_STORE_DIR:path.join(fixture,'images'),SOURCE_STORE_PATH:path.join(fixture,'sources.json'),SOURCE_STORE_ADAPTER:'local-json',ZVEC_STORE_PATH:path.join(fixture,'zvec'),PAPER_HOST_SESSION_VERIFY_URL:'https://sms-fixture.invalid/session?provider=knowtrail',DASHSCOPE_API_KEY:'fixture-image-key',DASHSCOPE_IMAGE_API_BASE:'https://image-gateway-fixture.invalid/api/v1',DASHSCOPE_IMAGE_MODEL:'qwen-image-2.0',OPENAI_COMPAT_API_KEY:'',ARK_API_KEY:'',OPENAI_API_KEY:'',REAL_SERVICE_FETCH_RETRIES:'1'});
  const app=createRequire(`${process.cwd()}/package.json`);
  const {NextRequest}=app('next/server');
  const {POST}=app('./src/app/api/ai/scientific-illustration/route.ts');
  const {saveNotebookDocument}=app('./src/lib/private-notebook-document.ts');
  const {ingestExtractedSource}=app('./src/lib/ingestion-store.ts');
  const {emptyIllustration}=app('./src/lib/scientific-illustration-document.ts');
  const scope={ownerMemberId:`paper-host:paper-user-${'a'.repeat(32)}`,notebookId:'illustration-form-fixture'};
  const previous=await saveNotebookDocument(scope,'scientific-illustration',{...emptyIllustration(),form:{purpose:'上一轮旧的概念框架示意图',figureKind:'conceptual-framework',aspectRatio:'1:1',requiredLabels:'旧标签'}},null);
  await ingestExtractedSource({id:'illustration-source',...scope,title:'软件验收模拟原文',fileName:'fixture.txt',fileType:'txt',content:'原文唯一标记：导入记录、检查时间戳、剔除缺失、人工核对。12条剔除2条保留10条，仅软件验收，非科研结果。'});
  let imageCalls=0;
  globalThis.fetch=async(input,init)=>{
    const url=String(input);
    if(url.includes('sms-fixture.invalid'))return Response.json({data:{authenticated:true,provider:'knowtrail',workspaceKey:'paper-user-'+'a'.repeat(32),capabilities:['verified-sms-session']}});
    if(url==='https://image-fixture.invalid/pixel.png')return new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'),{headers:{'Content-Type':'image/png'}});
    assert(url.includes('image-gateway-fixture.invalid')&&url.endsWith('/generation'),'No real paid network');
    const body=String(init?.body);assert(body.includes('原文唯一标记')&&!body.includes('FORGED-CLIENT-CONTENT'));
    imageCalls++;
    return Response.json({output:{choices:[{message:{content:[{image:'https://image-fixture.invalid/pixel.png'}]}}]}});
  };
  const form={purpose:'为本轮模拟资料生成四步流程示意图，不作科研外推。',figureKind:'workflow',aspectRatio:'16:9',requiredLabels:['导入','检查时间戳','剔除缺失','人工核对']};
  const response=await POST(new NextRequest('https://fixture.invalid/knowtrail/api/ai/scientific-illustration',{method:'POST',headers:{cookie:'userId=fixture; token=fixture-valid-a','Content-Type':'application/json'},body:JSON.stringify({...form,notebookId:scope.notebookId,papers:[{id:'illustration-source',title:'伪造标题',content:'FORGED-CLIENT-CONTENT'}],persistArtifact:true,runId:'11111111-1111-4111-8111-111111111111',expectedRevision:previous.revision})}));
  assert.equal(response.status,200);
  const payload=await response.json();
  const expected={...form,requiredLabels:form.requiredLabels.join('、')};
  const matches=JSON.stringify(payload.document.data.form)===JSON.stringify(expected);
  console.log(JSON.stringify({ok:matches,actualPostAndImageStore:true,imageCalls,paidCalls:0,savedForm:payload.document.data.form,expectedForm:expected,pixelFixtureIsNotScientificQuality:true}));
  assert.deepEqual(payload.document.data.form,expected,'Saved current form must describe this generated image, not a previous unrelated form');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
