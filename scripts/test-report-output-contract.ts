import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runResearchAgent } from '../src/lib/research-agent-runtime';

type ModelRequest = {
  messages: { role: string }[];
  tools: { function: { name: string; parameters: { properties: Record<string, { type: string }> } } }[];
};

async function main() {
  let requests = 0, generatedQuestion = '';
  const gateway = createServer(async (request, response) => {
    const bytes: Buffer[] = [];
    for await (const part of request) bytes.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(bytes).toString()) as ModelRequest;
    requests++;
    assert.ok(requests <= 2, 'The saved report must not trigger a third acknowledgement model call');
    const results = body.messages.filter(message => message.role === 'tool');
    const viewer = body.tools.find(tool => /skill/i.test(tool.function.name))?.function;
    assert.ok(viewer);
    const name = results.length ? 'generate_report' : viewer.name;
    const args = results.length ? { question: '核对保留10条。' } : Object.fromEntries(Object.entries(viewer.parameters.properties).map(([key, value]) => [key, value.type === 'array' ? ['grounded-report'] : 'grounded-report']));
    const delta = { content: '工具前说明不应成为报告最终正文。', tool_calls: [{ index: 0, id: 'report-'+requests, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const frame = (value: unknown, finish: string | null = null) => 'data: '+JSON.stringify({ id:'report-output', object:'chat.completion.chunk', created:1, model:'fixture', choices:[{index:0,delta:value,finish_reason:finish}] })+'\n\n';
    response.end(frame({role:'assistant',...delta})+frame({},'tool_calls')+'data: [DONE]\n\n');
  });
  try {
    await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
    process.env.ALLOW_PRIVATE_API_BASE='true';process.env.ALLOW_INSECURE_API_BASE='true';
    process.env.KNOWTRAIL_AGENT_PYTHON ||= 'python3';
    const message='生成报告：导入12条，剔除2条后保留10条。报告总共不超过250字，限定为软件验收。';
    const events=[];
    for await (const event of runResearchAgent({message,history:[],sessionId:'report-output-contract',sourceIds:['dedicated-source'],systemPrompt:'使用所选资料，不新增事实。',config:{apiBase:'http://127.0.0.1:'+(gateway.address() as AddressInfo).port+'/v1',apiKey:'fixture-key',model:'qwen3.8-flash'},signal:AbortSignal.timeout(20_000),generateReport:async question => {
      generatedQuestion=question;
      return {reference:{sourceIds:['dedicated-source'],question,revision:'a'.repeat(64),runId:'11111111-1111-4111-8111-111111111111',status:'complete'},preview:'保留10条[1]。'};
    }})) events.push(structuredClone(event));
    assert.equal(generatedQuestion,message,'Model-reworded tool arguments cannot replace the user output contract');
    assert.equal(requests,2,'Only the native method and actual tool selection use the fixture model');
    assert.equal(events.filter(event=>event.toolCall?.report).length,1);
    assert.equal(events.at(-1)?.replaceContent,'','The saved card replaces tool-stage commentary');
    console.log(JSON.stringify({ok:true,actualAgentScope:true,originalRequestPreserved:true,savedCardIsFinalResult:true,modelRequests:requests,paidCalls:0}));
  } finally { await new Promise<void>(resolve=>gateway.close(()=>resolve())); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
