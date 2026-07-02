import json
import time
import urllib.request

BASE = 'http://localhost:5801'

payload = {
    'name': 'diag-native',
    'description': 'diag',
    'model': 'doubao-seed-1-8-251228',
    'eval_type': 'openai_api',
    'eval_backend': 'Native',
    'api_url': 'https://ark.cn-beijing.volces.com/api/v3',
    'api_key': 'dummy-key',
    'datasets': ['gsm8k'],
    'generation_config': {},
    'dataset_args': {},
    'limit': 1,
}

def req_json(path: str, method: str = 'GET', body=None):
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(f'{BASE}{path}', data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode('utf-8'))

created = req_json('/api/tasks/', method='POST', body=payload)
print('CREATED', created['id'])
started = req_json(f"/api/tasks/{created['id']}/start", method='POST', body={})
print('STARTED', started['status'])
for i in range(12):
    time.sleep(1)
    t = req_json(f"/api/tasks/{created['id']}")
    print('POLL', i, t['status'], t.get('error_message'))
    if t['status'] in {'completed','failed','cancelled'}:
        break
