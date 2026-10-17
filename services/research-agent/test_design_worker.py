"""Actual installed AgentScope, local model protocol fixture, no paid calls."""
import json
from pathlib import Path
import subprocess
import sys
import threading
from http.server import ThreadingHTTPServer
from test_worker import Gateway

seen = []

class DesignGateway(Gateway):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        seen.append(body)
        tools = {t['function']['name']: t['function'] for t in body.get('tools', [])}
        results = [m for m in body['messages'] if m['role'] == 'tool']
        viewer = next((t for n, t in tools.items() if 'skill' in n.lower()), None)
        if not results and viewer:
            args = {k: (['research-design'] if v.get('type') == 'array' else 'research-design') for k, v in viewer['parameters']['properties'].items()}
            name = viewer['name']
        elif not any(m.get('name') == 'generate_research_design' for m in results):
            name = 'generate_research_design'
            args = {'kind': 'experiment-design' if any('生成协议' in str(m.get('content')) for m in body['messages'] if m['role'] == 'user') else 'hypothesis-generation', 'question': '仅核对12条剔除2条保留10条，不作科研外推。'}
            if args['kind'] == 'experiment-design':
                args['experiment'] = {'hypothesis': '检查可识别缺时间戳记录', 'experimentalUnit': '独立模拟记录', 'arms': ['检查组', '对照组'], 'primaryOutcome': '缺失识别率', 'constraints': '仅软件验收，不执行实验', 'alpha': 0.05, 'targetPower': 0.8}
        else:
            name = None
            args = {}
        delta = {'tool_calls': [{'index': 0, 'id': 'design-'+name, 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}]} if name else {'content': '请查看本轮已保存版本，未执行实验。'}
        event = {'id': 'design-fixture', 'object': 'chat.completion.chunk', 'created': 1, 'model': 'fixture-flash', 'choices': [{'index': 0, 'delta': {'role': 'assistant', **delta}, 'finish_reason': None}]}
        self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
        end = {**event, 'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'tool_calls' if name else 'stop'}]}
        self.wfile.write(('data: '+json.dumps(event)+'\n\ndata: '+json.dumps(end)+'\n\ndata: [DONE]\n\n').encode()); self.wfile.flush()

def check(server, message, kind):
    root = Path(__file__).parent
    bootstrap = {'message': message, 'plugins': ['hypothesis-generation','experiment-design'], 'systemPrompt': '按用户要求读取research-design Skill并实际调用生成工具。', 'sessionId': kind, 'history': [], 'model': {'apiKey': 'fixture', 'apiBase': f'http://127.0.0.1:{server.server_port}/v1', 'name': 'fixture-flash', 'maxTokens': 128}, 'skills': [{'id': 'research-design', 'description': '假设和采集前设计', 'instructions': (root/'skills/research-design/SKILL.md').read_text(encoding='utf-8')}]}
    proc = subprocess.Popen([sys.executable,'-u',str(root/'worker.py')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8')
    proc.stdin.write(json.dumps(bootstrap)+'\n'); proc.stdin.flush()
    events = []
    try:
        for line in proc.stdout:
            event = json.loads(line); events.append(event)
            if event['type'] == 'invoke':
                assert event['name'] == 'generate_research_design' and event['arguments']['kind'] == kind, event
                proc.stdin.write(json.dumps({'id': event['id'], 'result': {'success':True,'status':'design-saved'}})+'\n'); proc.stdin.flush()
        assert proc.wait(timeout=20) == 0, events
        assert sum(e['type']=='invoke' for e in events) == 1, ('Explicit generation never reached the host generator', events, [t['function']['name'] for t in seen[0].get('tools', [])], [m for m in seen[-1]['messages'] if m['role']=='tool'])
        assert any(e['type']=='end' and 'completed' in e['reason'].lower() for e in events), events
    finally:
        if proc.poll() is None: proc.kill(); proc.wait(timeout=5)

if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1',0),DesignGateway)
    thread = threading.Thread(target=server.serve_forever,daemon=True); thread.start()
    try:
        check(server,'生成假设','hypothesis-generation')
        check(server,'生成协议','experiment-design')
        assert any(m['role']=='tool' and '不能从一般经验猜' in str(m['content']) for r in seen for m in r['messages'])
        print(json.dumps({'ok':True,'actualSdk':True,'nativeSkillRead':True,'actualHostInvocations':2,'paidCalls':0}))
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=5)
