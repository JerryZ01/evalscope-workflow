import json
import time
import urllib.request

BASE = 'http://localhost:5801'

payload = {
    'name': 'smoke-mock-success',
    'description': 'quick success test',
    'model': 'mock-llm',
    'eval_type': 'mock_llm',
    'eval_backend': 'Native',
    'datasets': ['gsm8k'],
    'generation_config': {},
    'dataset_args': {},
    'limit': 5,
}

def req(path: str, method: str = 'GET', body=None):
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(f'{BASE}{path}', data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=60) as r:
        return json.loads(r.read().decode('utf-8'))

created = req('/api/tasks/', 'POST', payload)
print('CREATED', created['id'])
req(f"/api/tasks/{created['id']}/start", 'POST', {})
for i in range(40):
    time.sleep(1)
    t = req(f"/api/tasks/{created['id']}")
    print(i, t['status'], t.get('progress'), t.get('current_step'))
    if t['status'] in {'completed', 'failed', 'cancelled'}:
        break

logs = req(f"/api/tasks/{created['id']}/logs")
print('FINAL', t['status'], t.get('error_message'))
print('LAST_LOG', logs[0]['message'] if logs else None)
