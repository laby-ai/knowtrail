"""Actual installed SDK and local protocol fixture; no paid generation."""
import json
from pathlib import Path
import subprocess
import sys
import threading
from http.server import ThreadingHTTPServer
from test_worker import Gateway

seen = []

class MapGateway(Gateway):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        seen.append(body)
        tools = {t['function']['name']: t['function'] for t in body.get('tools', [])}
        results = [m for m in body['messages'] if m['role'] == 'tool']
        viewer = next((t for n, t in tools.items() if 'skill' in n.lower()), None)
        if not results and viewer:
            name = viewer['name']
            args = {k: ['knowledge-map'] if v.get('type') == 'array' else 'knowledge-map' for k, v in viewer['parameters']['properties'].items()}
        elif not any(m.get('name') in ['generate_knowledge_map', 'open_plugin'] for m in results):
            name = 'generate_knowledge_map' if 'generate_knowledge_map' in tools else 'open_plugin'
            args = {'question': '整理12条剔除2条保留10条的证据关系，限软件验收。', 'deepExtract': False} if name == 'generate_knowledge_map' else {'plugin': 'knowledge-map', 'request': '生成所选资料的研究脉络'}
        else:
            name, args = None, {}
        delta = {'tool_calls': [{'index': 0, 'id': 'map-'+name, 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}]} if name else {'content': '请查看本轮结果，关系仍需原文核对。'}
        event = {'id': 'map-fixture', 'object': 'chat.completion.chunk', 'created': 1, 'model': 'fixture-flash', 'choices': [{'index': 0, 'delta': {'role': 'assistant', **delta}, 'finish_reason': None}]}
        end = {**event, 'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'tool_calls' if name else 'stop'}]}
        self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
        self.wfile.write(('data: '+json.dumps(event)+'\n\ndata: '+json.dumps(end)+'\n\ndata: [DONE]\n\n').encode()); self.wfile.flush()

if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 0), MapGateway)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    root = Path(__file__).parent
    bootstrap = {'message': '根据已选资料生成研究脉络', 'plugins': ['knowledge-map'], 'systemPrompt': '先读knowledge-map Skill，再实际生成。', 'sessionId': 'map-fixture', 'history': [], 'model': {'apiKey': 'fixture', 'apiBase': f'http://127.0.0.1:{server.server_port}/v1', 'name': 'fixture-flash', 'maxTokens': 128}, 'skills': [{'id': 'knowledge-map', 'description': '本人资料关系', 'instructions': (root/'skills/knowledge-map/SKILL.md').read_text(encoding='utf8')}]}
    proc = subprocess.Popen([sys.executable, '-u', str(root/'worker.py')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf8')
    events = []
    try:
        proc.stdin.write(json.dumps(bootstrap)+'\n'); proc.stdin.flush()
        for line in proc.stdout:
            event = json.loads(line); events.append(event)
            if event['type'] == 'invoke':
                proc.stdin.write(json.dumps({'id': event['id'], 'result': {'success': True, 'status': 'map-saved'}})+'\n'); proc.stdin.flush()
        assert proc.wait(timeout=20) == 0, events
        calls = [e for e in events if e['type'] == 'invoke']
        assert len(calls) == 1 and calls[0]['name'] == 'generate_knowledge_map', ('Explicit generation only opens a plugin', calls)
        assert any(m['role'] == 'tool' and '不能冒称完整语义分析' in str(m['content']) for r in seen for m in r['messages'])
        print(json.dumps({'ok': True, 'actualSdk': True, 'nativeSkillRead': True, 'actualHostInvocations': calls, 'paidCalls': 0}))
    finally:
        if proc.poll() is None: proc.kill(); proc.wait(timeout=5)
        server.shutdown(); server.server_close(); thread.join(timeout=5)
