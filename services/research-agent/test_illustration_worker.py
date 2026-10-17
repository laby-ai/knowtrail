"""Real AgentScope and a local image-tool protocol fixture, never paid generation."""
import json
from pathlib import Path
import subprocess
import sys
import threading
from http.server import ThreadingHTTPServer
from test_worker import Gateway

seen = []
class IllustrationGateway(Gateway):
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['Content-Length'])));seen.append(body)
        tools={t['function']['name']:t['function'] for t in body.get('tools',[])}
        results=[m for m in body['messages'] if m['role']=='tool']
        viewer=next((t for n,t in tools.items() if 'skill' in n.lower()),None)
        if not results and viewer:
            name=viewer['name'];args={k:['scientific-illustration'] if v.get('type')=='array' else 'scientific-illustration' for k,v in viewer['parameters']['properties'].items()}
        elif not any(m.get('name') in ['generate_illustration','open_plugin'] for m in results):
            name='generate_illustration' if 'generate_illustration' in tools else 'open_plugin'
            args={'purpose':'为软件验收模拟资料绘制四步流程示意图，不作科研外推。','figureKind':'workflow','aspectRatio':'16:9','requiredLabels':['导入','检查时间戳','剔除缺失','人工核对']} if name=='generate_illustration' else {'plugin':'scientific-illustration','request':'按所选模拟资料生成四步流程示意图'}
        else:name=None;args={}
        delta={'tool_calls':[{'index':0,'id':'illustration-'+name,'type':'function','function':{'name':name,'arguments':json.dumps(args)}}]} if name else {'content':'本轮示意图已保存，科学含义和文字仍需核对。'}
        frame={'id':'illustration-fixture','object':'chat.completion.chunk','created':1,'model':'fixture-flash','choices':[{'index':0,'delta':{'role':'assistant',**delta},'finish_reason':None}]}
        end={**frame,'choices':[{'index':0,'delta':{},'finish_reason':'tool_calls' if name else 'stop'}]}
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
        self.wfile.write(('data: '+json.dumps(frame)+'\n\ndata: '+json.dumps(end)+'\n\ndata: [DONE]\n\n').encode());self.wfile.flush()

if __name__=='__main__':
    server=ThreadingHTTPServer(('127.0.0.1',0),IllustrationGateway)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    root=Path(__file__).parent
    bootstrap={'message':'按所选模拟资料生成四步流程示意图，标签为导入、检查时间戳、剔除缺失、人工核对','plugins':['scientific-illustration'],'systemPrompt':'先阅读scientific-illustration Skill，再实际生成，不能只打开窗口。','sessionId':'illustration-fixture','history':[],'model':{'apiKey':'fixture','apiBase':f'http://127.0.0.1:{server.server_port}/v1','name':'fixture-flash','maxTokens':128},'skills':[{'id':'scientific-illustration','description':'本人来源约束的示意图生成','instructions':'明确作图时调用generate_illustration，一次一张，保存后才能说已保存；仍需人工核图。'}]}
    proc=subprocess.Popen([sys.executable,'-u',str(root/'worker.py')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf8')
    events=[]
    try:
        proc.stdin.write(json.dumps(bootstrap)+'\n');proc.stdin.flush()
        for line in proc.stdout:
            event=json.loads(line);events.append(event)
            if event['type']=='invoke':proc.stdin.write(json.dumps({'id':event['id'],'result':{'success':True,'status':'image-saved','reviewRequired':True}})+'\n');proc.stdin.flush()
        assert proc.wait(timeout=20)==0,events
        calls=[e for e in events if e['type']=='invoke']
        result={'ok':len(calls)==1 and calls[0]['name']=='generate_illustration','actualSdk':True,'nativeSkillRead':len(seen)>1,'actualHostInvocations':calls,'paidCalls':0}
        print(json.dumps(result,ensure_ascii=False));assert result['ok'],'Explicit illustration generation only opens a plugin'
    finally:
        if proc.poll() is None:proc.kill();proc.wait(timeout=5)
        server.shutdown();server.server_close();thread.join(timeout=5)
