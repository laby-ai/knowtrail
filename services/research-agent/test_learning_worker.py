"""Real AgentScope with a local protocol provider; no paid calls."""
import json
from pathlib import Path
import subprocess
import sys
import threading
from http.server import ThreadingHTTPServer
from test_worker import Gateway

seen = []

class LearningGateway(Gateway):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        seen.append(body)
        tools = {t['function']['name']: t['function'] for t in body.get('tools', [])}
        results = [m for m in body['messages'] if m['role'] == 'tool']
        viewer = next((t for n, t in tools.items() if 'skill' in n.lower()), None)
        if not results and viewer:
            name = viewer['name']
            args = {k: ['grounded-learning'] if v.get('type') == 'array' else 'grounded-learning' for k, v in viewer['parameters']['properties'].items()}
        elif not any(m.get('name') in ['generate_learning_materials', 'open_plugin'] for m in results):
            name = 'generate_learning_materials' if 'generate_learning_materials' in tools else 'open_plugin'
            args = {'kind': 'quiz', 'question': '复习12条剔除2条保留10条的模拟记录，不作科研外推。'} if name == 'generate_learning_materials' else {'plugin': 'quiz', 'request': '用已选资料生成复习测验'}
        else:
            name, args = None, {}
        delta = {'tool_calls': [{'index': 0, 'id': 'learning-'+name, 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}]} if name else {'content': '本轮复习材料已保存；仅用于来源内容复习。'}
        frame = {'id':'learning-fixture','object':'chat.completion.chunk','created':1,'model':'fixture-flash','choices':[{'index':0,'delta':{'role':'assistant',**delta},'finish_reason':None}]}
        end = {**frame, 'choices':[{'index':0,'delta':{},'finish_reason':'tool_calls' if name else 'stop'}]}
        self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.end_headers()
        self.wfile.write(('data: '+json.dumps(frame)+'\n\ndata: '+json.dumps(end)+'\n\ndata: [DONE]\n\n').encode()); self.wfile.flush()

if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1',0),LearningGateway)
    thread = threading.Thread(target=server.serve_forever,daemon=True); thread.start()
    root = Path(__file__).parent
    bootstrap = {'message':'根据已选模拟记录生成复习测验','plugins':['knowledge-cards','quiz'],'systemPrompt':'先阅读grounded-learning Skill，再实际生成，不能只打开窗口。','sessionId':'learning-fixture','history':[],'model':{'apiKey':'fixture','apiBase':f'http://127.0.0.1:{server.server_port}/v1','name':'fixture-flash','maxTokens':128},'skills':[{'id':'grounded-learning','description':'从已选资料生成复习材料','instructions':'明确生成时调用generate_learning_materials，保存后才说明完成。'}]}
    proc = subprocess.Popen([sys.executable,'-u',str(root/'worker.py')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf8')
    events = []
    try:
        proc.stdin.write(json.dumps(bootstrap)+'\n'); proc.stdin.flush()
        for line in proc.stdout:
            event=json.loads(line); events.append(event)
            if event['type']=='invoke':
                proc.stdin.write(json.dumps({'id':event['id'],'result':{'success':True,'status':'materials-saved','instruction':'仅用于来源内容复习，不代表科学质量评估。'}})+'\n'); proc.stdin.flush()
        assert proc.wait(timeout=20)==0,events
        calls=[e for e in events if e['type']=='invoke']
        result={'ok':len(calls)==1 and calls[0]['name']=='generate_learning_materials','actualSdk':True,'nativeSkillRead':len(seen)>1,'actualHostInvocations':calls,'paidCalls':0}
        print(json.dumps(result,ensure_ascii=False))
        assert result['ok'], 'Explicit learning generation only opens a plugin'
    finally:
        if proc.poll() is None: proc.kill(); proc.wait(timeout=5)
        server.shutdown(); server.server_close(); thread.join(timeout=5)
