"""Zero-paid-call integration: real AgentScope against a local OpenAI SSE fixture."""
import json
from pathlib import Path
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

requests = []


class Gateway(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        requests.append(body)
        messages = body['messages']
        tool_messages = [m for m in messages if m['role'] == 'tool']
        tools = {t['function']['name']: t['function'] for t in body.get('tools', [])}
        viewer = next((t for n,t in tools.items() if 'skill' in n.lower()), None)
        if not tool_messages and viewer:
            properties = viewer['parameters']['properties']
            arguments = {k: (['paper-search'] if value.get('type') == 'array' else 'paper-search') for k,value in properties.items()}
            delta = {'tool_calls': [{'index': 0, 'id': 'read-skill', 'type': 'function', 'function': {'name': viewer['name'], 'arguments': json.dumps(arguments)}}]}
        elif not any('fixture-candidate' in str(m['content']) or 'window-ready' in str(m['content']) for m in tool_messages):
            plugin = any('打开PPT' in str(m.get('content')) for m in messages if m['role'] == 'user')
            name = 'open_plugin' if plugin else 'search_papers'
            arguments = {'plugin': 'presentation', 'request': '制作两页方法对比'} if plugin else {'query': 'exoplanet transit'}
            delta = {'tool_calls': [{'index': 0, 'id': 'run-plugin', 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(arguments)}}]}
        else:
            delta = {'content': '根据本轮实际工具结果继续处理。'}
        finish = 'tool_calls' if 'tool_calls' in delta else 'stop'
        frames = [
            {'id':'fixture','object':'chat.completion.chunk','created':1,'model':'fixture-max','choices':[{'index':0,'delta':{'role':'assistant',**delta},'finish_reason':None}]},
            {'id':'fixture','object':'chat.completion.chunk','created':1,'model':'fixture-max','choices':[{'index':0,'delta':{},'finish_reason':finish}],'usage':{'prompt_tokens':12,'completion_tokens':8,'total_tokens':20}},
        ]
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
        for frame in frames:
            self.wfile.write(('data: '+json.dumps(frame)+'\n\n').encode())
        self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()


def run_worker(server, message, session):
    initial = {'message':message,'plugins':['paper-search','presentation'],'systemPrompt':'这是隔离软件验收，不是真实科研结果。使用工具后回答。',
               'sessionId':session,'history':[{'role':'user','content':'只属于'+session}],
               'model':{'apiKey':'fixture-only','apiBase':f'http://127.0.0.1:{server.server_port}/v1','name':'fixture-max','maxTokens':128},
               'skills':[{'id':'paper-search','description':'搜索真实候选','instructions':'NATIVE_SKILL_MARKER: 读取此方法后使用 search_papers，结果必须真实。'}]}
    proc=subprocess.Popen([sys.executable,'-u',str(Path(__file__).with_name('worker.py'))],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8')
    proc.stdin.write(json.dumps(initial,ensure_ascii=False)+'\n');proc.stdin.flush()
    events=[]
    try:
        for line in proc.stdout:
            event=json.loads(line);events.append(event)
            if event['type']=='invoke':
                result={'success':True,'results':[{'title':'fixture-candidate','link':'https://arxiv.org/abs/0000.00001'}]} if event['name']=='search_papers' else {'success':True,'status':'window-ready'}
                proc.stdin.write(json.dumps({'id':event['id'],'result':result})+'\n');proc.stdin.flush()
        status=proc.wait(timeout=30)
        assert status==0,(status,events,proc.stderr.read()[-800:])
        assert any(e['type']=='ready' and e['engine']=='agentscope' for e in events)
        assert any(e['type']=='invoke' for e in events),events
        assert any(e['type']=='text' and e['delta'] for e in events),events
        assert any(e['type']=='end' and 'completed' in e['reason'].lower() for e in events),events
        return events
    finally:
        if proc.poll() is None:proc.kill();proc.wait(timeout=5)


if __name__=='__main__':
    server=ThreadingHTTPServer(('127.0.0.1',0),Gateway)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        a=run_worker(server,'搜索论文','isolated-A')
        split=len(requests)
        b=run_worker(server,'打开PPT','isolated-B')
        assert 'isolated-A' not in json.dumps(requests[split:])
        assert any(e.get('name')=='search_papers' for e in a)
        assert any(e.get('name')=='open_plugin' for e in b)
        assert any(any(m['role']=='tool' and 'NATIVE_SKILL_MARKER' in str(m['content']) for m in request['messages']) for request in requests),('Native Skill instructions were not consumed', [(t['function']['name'],t['function']['parameters']) for t in requests[0]['tools']], [m for r in requests for m in r['messages'] if m['role']=='tool'])
        print(json.dumps({'ok':True,'sdk':'agentscope==2.0.10','realSdk':True,'nativeSkillRead':True,'hostSearchCalls':1,'pluginWindowCalls':1,'sessionHistorySeparated':True,'modelRequests':len(requests),'paidCalls':0}))
    finally:
        server.shutdown();server.server_close();thread.join(timeout=5)
