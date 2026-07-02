import json
import time
import urllib.request

base = 'http://localhost:5801'

payload = {
    'name': 'smoke-task-mock',
    'description': 'smoke test for workflow',
    'model': 'text_generation',
    'eval_type': 'mock_llm',
    'eval_backend': 'Native',
    'datasets': ['gsm8k'],
    'generation_config': {},
    'dataset_args': {},
    'limit': 1,
}

req = urllib.request.Request(
    f'{base}/api/tasks/',
    data=json.dumps(payload).encode('utf-8'),
    headers={'Content-Type': 'application/json'},
    method='POST',
)
with urllib.request.urlopen(req, timeout=20) as resp:
    created = json.loads(resp.read().decode())
print('CREATED', json.dumps(created, ensure_ascii=False))

task_id = created['id']
req = urllib.request.Request(f'{base}/api/tasks/{task_id}/start', data=b'', method='POST')
with urllib.request.urlopen(req, timeout=20) as resp:
    started = json.loads(resp.read().decode())
print('STARTED', json.dumps(started, ensure_ascii=False))

final_task = None
for _ in range(30):
    time.sleep(2)
    with urllib.request.urlopen(f'{base}/api/tasks/{task_id}', timeout=20) as resp:
        final_task = json.loads(resp.read().decode())
    print('POLL', json.dumps({
        'id': final_task.get('id'),
        'status': final_task.get('status'),
        'progress': final_task.get('progress'),
        'current_step': final_task.get('current_step'),
        'error_message': final_task.get('error_message'),
        'output_dir': final_task.get('output_dir'),
    }, ensure_ascii=False))
    if final_task['status'] in {'completed', 'failed', 'cancelled'}:
        break

with urllib.request.urlopen(f'{base}/api/tasks/{task_id}/logs', timeout=20) as resp:
    logs = json.loads(resp.read().decode())
print('LOG_COUNT', len(logs))

with urllib.request.urlopen(f'{base}/api/tasks/{task_id}/results', timeout=20) as resp:
    results = json.loads(resp.read().decode())
print('RESULT_COUNT', len(results))
print('FINAL', json.dumps(final_task, ensure_ascii=False))
