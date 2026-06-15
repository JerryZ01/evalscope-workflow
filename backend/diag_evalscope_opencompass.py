import traceback
from evalscope import TaskConfig, run_task

cfg = TaskConfig(
    model='doubao-seed-1-8-251228',
    datasets=['gsm8k'],
    eval_type='openai_api',
    eval_backend='OpenCompass',
    api_url='https://ark.cn-beijing.volces.com/api/v3',
    api_key='dummy-key',
    generation_config={},
    dataset_args={},
    limit=1,
    no_timestamp=True,
    work_dir='/tmp/evalscope-diag-opencompass',
)

try:
    result = run_task(cfg)
    print('SUCCESS', result)
except Exception as e:
    print('ERROR', type(e).__name__, str(e))
    traceback.print_exc()
