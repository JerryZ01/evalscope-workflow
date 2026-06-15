import json
import time
import urllib.request
import urllib.error

BASE = 'http://localhost:5801'

payload = {
    'name': 'diag-doubao',
    'description': 'diag',
    'model': 'doubao-seed-1-8-251228',
    'eval_type': 'openai_api',
    'eval_backend': 'OpenCompass',
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


try:
    created = req_json('/api/tasks/', method='POST', body=payload)
    print('CREATED', json.dumps(created, ensure_ascii=False))
except urllib.error.HTTPError as e:
    print('CREATE_HTTP_ERROR', e.code, e.read().decode('utf-8', errors='ignore'))
    raise SystemExit(1)


task_id = created['id']

try:
    started = req_json(f'/api/tasks/{task_id}/start', method='POST', body={})
    print('STARTED', json.dumps(started, ensure_ascii=False))
except urllib.error.HTTPError as e:
    print('START_HTTP_ERROR', e.code, e.read().decode('utf-8', errors='ignore'))
    raise SystemExit(1)

for i in range(20):
    time.sleep(1.2)
    task = req_json(f'/api/tasks/{task_id}')
    print('POLL', i, task.get('status'), task.get('current_step'), task.get('error_message'))
    if task.get('status') in {'completed', 'failed', 'cancelled'}:
        break

logs = req_json(f'/api/tasks/{task_id}/logs')
print('LOGS_TOP')
for item in logs[:15]:
    print(item.get('timestamp'), item.get('level'), item.get('message'))
