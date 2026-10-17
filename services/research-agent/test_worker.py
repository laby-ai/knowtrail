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
        if 'select_report_action' in tools:
            self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers()
            result={'id':'report-admission','object':'chat.completion','created':1,'model':'fixture-aux','choices':[{'index':0,'message':{'role':'assistant','content':None,'tool_calls':[{'id':'report-action','type':'function','function':{'name':'select_report_action','arguments':json.dumps({'action':'generate' if any('生成报告' in str(m.get('content')) for m in messages if m['role']=='user') else 'other'})}}]},'finish_reason':'tool_calls'}]}
            self.wfile.write(json.dumps(result).encode());return
        prepare = any('准备可编辑PPT' in str(m.get('content')) for m in messages if m['role'] == 'user')
        report = any('生成报告' in str(m.get('content')) for m in messages if m['role'] == 'user')
        viewer = next((t for n,t in tools.items() if 'skill' in n.lower()), None)
        if not tool_messages and viewer:
            properties = viewer['parameters']['properties']
            skill = 'grounded-report' if report else 'editable-ppt' if prepare else 'paper-search'
            arguments = {k: ([skill] if value.get('type') == 'array' else skill) for k,value in properties.items()}
            delta = {'tool_calls': [{'index': 0, 'id': 'read-skill', 'type': 'function', 'function': {'name': viewer['name'], 'arguments': json.dumps(arguments)}}]}
        elif not any('fixture-candidate' in str(m['content']) or 'window-ready' in str(m['content']) or 'outline-ready' in str(m['content']) or 'report-saved' in str(m['content']) for m in tool_messages):
            plugin = any('打开PPT' in str(m.get('content')) for m in messages if m['role'] == 'user')
            name = 'open_plugin' if plugin else 'search_papers'
            arguments = {'plugin': 'presentation', 'request': '制作两页方法对比'} if plugin else {'query': 'exoplanet transit'}
            if prepare:
                name = 'prepare_presentation'
                arguments = {'outline': [{'title':'软件验收模拟记录','focus':'说明仅用于软件验收，不是真实科研结果[1]。'}, {'title':'12条记录剔除2条保留10条','focus':'保留12、2、10的原文数量和缺失时间戳条件[1]。'}, {'title':'四步核验流程','focus':'导入记录→检查时间戳→剔除缺失→人工核对[1]。'}]}
            if report:
                name = 'generate_report'
                arguments = {'question': '核对12条剔除2条保留10条和四步顺序，仅用于软件验收。'}
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
               'model':{'apiKey':'fixture-only','apiBase':f'http://127.0.0.1:{server.server_port}/v1','name':'fixture-max','auxModel':'fixture-flash','maxTokens':128},
               'skills':[{'id':'paper-search','description':'搜索真实候选','instructions':'NATIVE_SKILL_MARKER: 读取此方法后使用 search_papers，结果必须真实。'}, {'id':'editable-ppt','description':'准备可编辑PPT','instructions':Path(__file__).with_name('skills').joinpath('editable-ppt/SKILL.md').read_text(encoding='utf8')}, {'id':'grounded-report','description':'生成本人报告','instructions':Path(__file__).with_name('skills').joinpath('grounded-report/SKILL.md').read_text(encoding='utf8')}]}
    proc=subprocess.Popen([sys.executable,'-u',str(Path(__file__).with_name('worker.py'))],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8')
    proc.stdin.write(json.dumps(initial,ensure_ascii=False)+'\n');proc.stdin.flush()
    events=[]
    try:
        for line in proc.stdout:
            event=json.loads(line);events.append(event)
            if event['type']=='invoke':
                result={'success':True,'results':[{'title':'fixture-candidate','link':'https://arxiv.org/abs/0000.00001'}]} if event['name']=='search_papers' else {'success':True,'status':'report-saved' if event['name']=='generate_report' else 'outline-ready' if event['name']=='prepare_presentation' else 'window-ready'}
                proc.stdin.write(json.dumps({'id':event['id'],'result':result})+'\n');proc.stdin.flush()
        status=proc.wait(timeout=30)
        assert status==0,(status,events,proc.stderr.read()[-800:])
        assert any(e['type']=='ready' and e['engine']=='agentscope' for e in events)
        assert any(e['type']=='invoke' for e in events),events
        assert message == '生成报告' or any(e['type']=='text' and e['delta'] for e in events),events
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
        c=run_worker(server,'准备可编辑PPT','isolated-C')
        d=run_worker(server,'生成报告','isolated-D')
        assert any(e.get('name')=='search_papers' for e in a)
        assert any(e.get('name')=='open_plugin' for e in b)
        assert any(e.get('name')=='prepare_presentation' and len(e['arguments']['outline'])==3 for e in c)
        assert any(e.get('name')=='generate_report' and e['arguments']['question']=='生成报告' for e in d)
        assert any(any(m['role']=='system' and '调用 generate_report(question)' in str(m['content']) for m in request['messages']) and request.get('tool_choice',{}).get('function',{}).get('name')=='select_report_action' for request in requests)
        assert any(any(m['role']=='tool' and 'prepare_presentation(outline)' in str(m['content']) for m in request['messages']) for request in requests)
        assert any(any(m['role']=='tool' and 'NATIVE_SKILL_MARKER' in str(m['content']) for m in request['messages']) for request in requests),('Native Skill instructions were not consumed', [(t['function']['name'],t['function']['parameters']) for t in requests[0]['tools']], [m for r in requests for m in r['messages'] if m['role']=='tool'])
        print(json.dumps({'ok':True,'sdk':'agentscope==2.0.10','realSdk':True,'nativeSkillRead':True,'hostSearchCalls':1,'pluginWindowCalls':1,'presentationOutlineCalls':1,'reportGenerationCalls':1,'sessionHistorySeparated':True,'modelRequests':len(requests),'paidCalls':0}))
    finally:
        server.shutdown();server.server_close();thread.join(timeout=5)
