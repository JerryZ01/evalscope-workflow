"""
EvalScope Executor - 封装 EvalScope 的执行能力
"""
import copy
import json
import os
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Optional

try:
    from evalscope import TaskConfig, run_task
except ImportError:
    TaskConfig = None
    run_task = None


class TaskCancelledError(RuntimeError):
    pass


def _sanitize(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(k): _sanitize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_sanitize(v) for v in value]
    if isinstance(value, Path):
        return str(value)
    if hasattr(value, 'model_dump'):
        return _sanitize(value.model_dump())
    if hasattr(value, 'dict'):
        return _sanitize(value.dict())
    if hasattr(value, '__dict__'):
        return _sanitize(vars(value))
    return str(value)


class EvalScopeExecutor:
    """EvalScope 执行器"""

    def __init__(self, output_dir: Optional[str] = None):
        if output_dir is None:
            from app.core.config import settings
            output_dir = settings.EVALSCOPE_WORK_DIR
        self.output_dir = output_dir
        self._running_tasks: Dict[str, threading.Thread] = {}
        self._task_status: Dict[str, Dict[str, Any]] = {}
        self._cancel_events: Dict[str, threading.Event] = {}

    def create_task_config(
        self,
        model: str,
        datasets: list,
        eval_type: str = 'openai_api',
        eval_backend: str = 'Native',
        api_url: Optional[str] = None,
        api_key: Optional[str] = None,
        generation_config: Optional[Dict] = None,
        dataset_args: Optional[Dict] = None,
        limit: Optional[int] = None,
        work_dir: Optional[str] = None,
        **kwargs,
    ) -> 'TaskConfig':
        if TaskConfig is None:
            raise RuntimeError('EvalScope is not available')

        config_dict = {
            'model': model,
            'datasets': datasets,
            'eval_type': eval_type,
            'eval_backend': eval_backend,
            'work_dir': work_dir or self.output_dir,
            'no_timestamp': True,
        }

        if api_url:
            config_dict['api_url'] = api_url
        if api_key:
            config_dict['api_key'] = api_key
        if generation_config is not None:
            config_dict['generation_config'] = generation_config
        if dataset_args is not None:
            config_dict['dataset_args'] = dataset_args
        if limit is not None:
            config_dict['limit'] = limit

        config_dict.update(kwargs)

        if config_dict.get('eval_config') is None:
            config_dict['eval_config'] = {}

        return TaskConfig(**config_dict)

    @staticmethod
    def _extract_engine_message(raw_line: str) -> Optional[str]:
        line = raw_line.strip()
        if not line:
            return None
        marker = ' - evalscope - '
        if marker in line:
            line = line.split(marker, 1)[1]
        for level_prefix in ('INFO: ', 'WARNING: ', 'ERROR: ', 'DEBUG: '):
            if line.startswith(level_prefix):
                return line[len(level_prefix):]
        return line

    def _tail_eval_log(
        self,
        log_file: Path,
        stop_event: threading.Event,
        log_callback: Optional[Callable[[str, str], None]],
    ) -> None:
        position = 0
        while not stop_event.is_set():
            if log_file.exists():
                try:
                    size = log_file.stat().st_size
                    if size < position:
                        position = 0
                    with log_file.open('r', encoding='utf-8', errors='ignore') as f:
                        f.seek(position)
                        for raw_line in f:
                            message = self._extract_engine_message(raw_line)
                            if message and log_callback:
                                log_callback('INFO', f'[evalscope] {message}')
                        position = f.tell()
                except Exception:
                    pass
            stop_event.wait(1.0)

    def run_evaluation(
        self,
        task_id: str,
        config: 'TaskConfig',
        progress_callback: Optional[Callable[[float, str, Dict[str, Any]], None]] = None,
        log_callback: Optional[Callable[[str, str], None]] = None,
    ) -> Dict[str, Any]:
        if TaskConfig is None or run_task is None:
            raise RuntimeError('EvalScope is not available')

        from app.core.output_paths import build_run_directory_name

        base_task_dir = Path(self.output_dir).resolve() / build_run_directory_name()
        base_task_dir.mkdir(parents=True, exist_ok=True)
        cancel_event = self._cancel_events.setdefault(task_id, threading.Event())

        datasets = list(config.datasets or [])
        total_datasets = len(datasets) or 1
        aggregated_results: Dict[str, Any] = {}
        started_at = datetime.utcnow().isoformat()
        file_tail_stop = threading.Event()
        file_tail_thread: Optional[threading.Thread] = None

        try:
            if log_callback:
                log_callback('INFO', f'Starting evaluation for task {task_id}')
                log_callback('INFO', f'Planned datasets: {", ".join(datasets) if datasets else "(none)"}')

            if progress_callback:
                progress_callback(0.0, '初始化任务', {'started_at': started_at, 'total_datasets': total_datasets})

            for index, dataset in enumerate(datasets or ['default']):
                if cancel_event.is_set():
                    raise TaskCancelledError('Task cancellation requested')

                dataset_dir = base_task_dir / dataset.replace('/', '_').replace('\\', '_')
                dataset_dir.mkdir(parents=True, exist_ok=True)
                dataset_config = copy.deepcopy(config)
                dataset_config.datasets = [dataset]
                dataset_config.work_dir = str(dataset_dir)
                dataset_config.no_timestamp = True

                eval_log_path = dataset_dir / 'logs' / 'eval_log.log'
                file_tail_stop.clear()
                file_tail_thread = threading.Thread(
                    target=self._tail_eval_log,
                    args=(eval_log_path, file_tail_stop, log_callback),
                    daemon=True,
                    name=f'evalscope-log-tail-{task_id}-{index}',
                )
                file_tail_thread.start()

                if progress_callback:
                    progress_callback(index / total_datasets, f'正在评测 {dataset}', {
                        'dataset': dataset,
                        'index': index + 1,
                        'total_datasets': total_datasets,
                    })

                if log_callback:
                    log_callback('INFO', f'Running dataset {index + 1}/{total_datasets}: {dataset}')

                result = run_task(dataset_config)
                aggregated_results[dataset] = _sanitize(result)

                file_tail_stop.set()
                if file_tail_thread is not None:
                    file_tail_thread.join(timeout=2)
                    file_tail_thread = None
                if eval_log_path.exists() and log_callback:
                    try:
                        with eval_log_path.open('r', encoding='utf-8', errors='ignore') as f:
                            last_line = ''
                            for raw in f:
                                parsed = self._extract_engine_message(raw)
                                if parsed:
                                    last_line = parsed
                            if last_line:
                                log_callback('INFO', f'[evalscope] {last_line}')
                    except Exception:
                        pass

                report_path = dataset_dir / 'result.json'
                report_path.write_text(json.dumps(_sanitize(result), ensure_ascii=False, indent=2), encoding='utf-8')

                if progress_callback:
                    progress_callback((index + 1) / total_datasets, f'已完成 {dataset}', {
                        'dataset': dataset,
                        'index': index + 1,
                        'total_datasets': total_datasets,
                    })
                if log_callback:
                    log_callback('INFO', f'Finished dataset: {dataset}')

            summary = {
                'status': 'completed',
                'datasets': list(aggregated_results.keys()),
                'total_datasets': len(aggregated_results),
                'completed_at': datetime.utcnow().isoformat(),
            }

            if log_callback:
                log_callback('INFO', f'Evaluation completed for task {task_id}')

            self._task_status[task_id] = {
                'status': 'completed',
                'output_dir': str(base_task_dir),
                'results': aggregated_results,
                'summary': summary,
            }
            return self._task_status[task_id]

        except TaskCancelledError as exc:
            if log_callback:
                log_callback('WARNING', str(exc))
            result = {
                'status': 'cancelled',
                'output_dir': str(base_task_dir),
                'results': aggregated_results,
                'summary': {
                    'status': 'cancelled',
                    'datasets': list(aggregated_results.keys()),
                    'total_datasets': len(aggregated_results),
                    'completed_at': datetime.utcnow().isoformat(),
                },
                'message': str(exc),
            }
            self._task_status[task_id] = result
            return result
        except Exception as exc:
            error_msg = str(exc)
            if log_callback:
                log_callback('ERROR', f'Evaluation failed: {error_msg}')
            result = {
                'status': 'failed',
                'output_dir': str(base_task_dir),
                'results': aggregated_results,
                'summary': {
                    'status': 'failed',
                    'datasets': list(aggregated_results.keys()),
                    'total_datasets': len(aggregated_results),
                    'completed_at': datetime.utcnow().isoformat(),
                },
                'message': error_msg,
            }
            self._task_status[task_id] = result
            return result
        finally:
            file_tail_stop.set()
            if file_tail_thread is not None:
                file_tail_thread.join(timeout=2)
            self._running_tasks.pop(task_id, None)

    def run_evaluation_async(
        self,
        task_id: str,
        config: 'TaskConfig',
        progress_callback: Optional[Callable[[float, str, Dict[str, Any]], None]] = None,
        log_callback: Optional[Callable[[str, str], None]] = None,
        finish_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> None:
        cancel_event = threading.Event()
        self._cancel_events[task_id] = cancel_event

        def run_in_thread():
            result = self.run_evaluation(
                task_id=task_id,
                config=config,
                progress_callback=progress_callback,
                log_callback=log_callback,
            )
            if finish_callback:
                finish_callback(result)

        thread = threading.Thread(target=run_in_thread, daemon=True, name=f'evalscope-task-{task_id}')
        thread.start()
        self._running_tasks[task_id] = thread

    def get_task_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        return self._task_status.get(task_id)

    def cancel_task(self, task_id: str) -> bool:
        cancel_event = self._cancel_events.get(task_id)
        if cancel_event is not None:
            cancel_event.set()
            self._task_status[task_id] = {
                'status': 'cancelling',
                'message': 'Task cancellation requested',
            }
            return True
        return False


executor = EvalScopeExecutor()
