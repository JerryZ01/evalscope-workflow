"""
EvalScope 评测执行器
负责执行评测任务并收集结果
"""
import asyncio
import glob as glob_module
import json
import logging
import os
import time
from queue import Empty
from typing import Dict, Any, Optional, Callable
from dataclasses import dataclass

from app.core.eval_process import run_eval_subprocess

logger = logging.getLogger(__name__)


@dataclass
class EvalResult:
    """评测结果"""
    success: bool
    score: float = 0.0
    metrics: list = None
    error: Optional[str] = None
    duration: float = 0.0
    output_dir: Optional[str] = None  # 实际输出目录

    def __post_init__(self):
        if self.metrics is None:
            self.metrics = []


def _read_score_from_report_file(work_dir: Optional[str]) -> dict:
    """
    从生成的报告 JSON 文件中读取 score 和 metrics

    Args:
        work_dir: 工作目录（如 ./outputs/task_1/20260415_112810）

    Returns:
        包含 score 和 metrics 的 dict，如果没有找到则返回空 dict
    """
    if not work_dir:
        return {}

    # work_dir 可能是 ./outputs/task_1 或 ./outputs/task_1/20260415_112810
    # 报告文件位于 reports/<model_name>/<dataset>.json
    reports_dir = os.path.join(work_dir, 'reports')
    if not os.path.isdir(reports_dir):
        return {}

    all_scores = []
    all_metrics = []
    try:
        json_files = glob_module.glob(os.path.join(reports_dir, '**', '*.json'), recursive=True)
        for json_file in json_files:
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                if 'score' in data:
                    all_scores.append(float(data['score']))
                if 'metrics' in data and isinstance(data['metrics'], list):
                    all_metrics.extend(data['metrics'])
            except Exception:
                pass
    except Exception:
        pass

    if all_scores:
        return {'score': sum(all_scores) / len(all_scores), 'metrics': all_metrics}
    return {}


def _extract_error_from_log(work_dir: Optional[str]) -> Optional[str]:
    """
    从日志文件中提取 ERROR 行，作为失败原因

    Args:
        work_dir: 工作目录

    Returns:
        第一个 ERROR 行的内容，如果没有则返回 None
    """
    if not work_dir:
        return None

    # 找到最新的日志目录
    try:
        if os.path.isdir(work_dir):
            subdirs = [d for d in os.listdir(work_dir) if os.path.isdir(os.path.join(work_dir, d))]
            if not subdirs:
                return None
            latest = max(subdirs, key=lambda x: os.path.getmtime(os.path.join(work_dir, x)))
            log_file = os.path.join(work_dir, latest, 'logs', 'eval_log.log')
        else:
            log_file = None

        if log_file and os.path.exists(log_file):
            content = open(log_file, encoding='utf-8', errors='ignore').read()
            lines = content.split('\n')
            for line in lines:
                if ' ERROR ' in line or 'ERROR:' in line or 'Traceback' in line:
                    # 提取关键错误信息
                    if 'not found' in line.lower() or 'error' in line.lower():
                        return line.strip()
            # 如果没有 ERROR，找最后几行有用信息
            for line in reversed(lines):
                if line.strip() and not line.startswith(' ' * 4) and len(line.strip()) > 10:
                    return line.strip()
    except Exception:
        pass
    return None


def _dataclass_to_dict(obj) -> dict:
    """将 dataclass 对象转换为普通 dict（确保 JSON 可序列化）"""
    if hasattr(obj, 'to_dict'):
        return obj.to_dict()
    if hasattr(obj, '__dict__'):
        result = {}
        for k, v in obj.__dict__.items():
            if not k.startswith('_'):
                if hasattr(v, 'to_dict'):
                    result[k] = v.to_dict()
                elif isinstance(v, list):
                    result[k] = [_dataclass_to_dict(item) if hasattr(item, '__dict__') else item for item in v]
                elif hasattr(v, '__dict__'):
                    result[k] = _dataclass_to_dict(v)
                else:
                    result[k] = v
        return result
    return obj


def _process_report_result(report: Any, work_dir: Optional[str]) -> tuple[dict, list, list, Optional[str]]:
    """
    处理 run_task 返回的报告结果，提取 score 和 metrics

    run_task 返回类型：
    - dict[str, Report]: {'gsm8k': Report(...)}
    - {}: 空 dict（没有有效样本时）
    - {'score': 0.0, 'error': '...'} 异常时的 fallback（走 fallback 读取报告文件）

    Args:
        report: run_task 的返回值
        work_dir: 工作目录，用于从报告文件 fallback

    Returns:
        (result_dict, all_scores, all_metrics, error_hint)
    """
    all_scores = []
    all_metrics = []
    result_dict = {}
    error_hint = None

    if isinstance(report, dict) and report:
        # 判断是否是有数据的结果 dict
        has_valid_data = False
        for key, value in report.items():
            if isinstance(value, dict) and ('score' in value or 'metrics' in value):
                # {'gsm8k': {'score': 0.85, 'metrics': [...]}}
                has_valid_data = True
                all_scores.append(value.get('score', 0.0))
                metrics = value.get('metrics', [])
                if isinstance(metrics, list):
                    for m in metrics:
                        all_metrics.append(_dataclass_to_dict(m) if hasattr(m, '__dict__') else m)
                elif metrics:
                    all_metrics.append(_dataclass_to_dict(metrics) if hasattr(metrics, '__dict__') else metrics)
            elif hasattr(value, 'score'):
                # {'gsm8k': Report 对象}
                has_valid_data = True
                all_scores.append(float(value.score))
                metrics = value.metrics if hasattr(value, 'metrics') else []
                if isinstance(metrics, list):
                    for m in metrics:
                        all_metrics.append(_dataclass_to_dict(m) if hasattr(m, '__dict__') else m)
                elif metrics:
                    all_metrics.append(_dataclass_to_dict(metrics) if hasattr(metrics, '__dict__') else metrics)
            elif isinstance(value, str) and 'error' in value.lower():
                error_hint = value

        if has_valid_data:
            result_dict = {'score': sum(all_scores) / len(all_scores) if all_scores else 0.0, 'metrics': all_metrics}
        else:
            # 没有有效数据，从报告文件 fallback，并从日志提取错误原因
            result_dict = _read_score_from_report_file(work_dir)
            all_scores = [result_dict['score']] if 'score' in result_dict else []
            all_metrics = result_dict.get('metrics', [])
            if not result_dict:
                error_hint = _extract_error_from_log(work_dir) or error_hint

    elif isinstance(report, dict) and not report:
        # 空 dict: 从报告文件读取，并尝试从日志提取错误
        result_dict = _read_score_from_report_file(work_dir)
        all_scores = [result_dict['score']] if 'score' in result_dict else []
        all_metrics = result_dict.get('metrics', [])
        if not result_dict:
            error_hint = _extract_error_from_log(work_dir)

    elif hasattr(report, 'score'):
        # 单个 Report 对象
        result_dict = report.to_dict() if hasattr(report, 'to_dict') else {
            'score': float(report.score), 'metrics': []
        }
        all_scores = [float(report.score)]
        mlist = report.metrics if hasattr(report, 'metrics') and report.metrics else []
        all_metrics = [_dataclass_to_dict(m) if hasattr(m, '__dict__') else m for m in mlist]

    return result_dict, all_scores, all_metrics, error_hint


def _read_log_increment(log_file_path: str, last_offset: int) -> tuple:
    """读取日志文件的增量内容

    Returns:
        (new_content, new_offset) - 新增的日志文本和新的文件偏移量
    """
    try:
        if not os.path.exists(log_file_path):
            return "", last_offset
        file_size = os.path.getsize(log_file_path)
        if file_size <= last_offset:
            return "", last_offset
        with open(log_file_path, 'r', encoding='utf-8', errors='ignore') as f:
            f.seek(last_offset)
            new_content = f.read()
            new_offset = f.tell()
        return new_content, new_offset
    except Exception:
        return "", last_offset


async def _broadcast_log_increment(task_id: int, new_logs: str):
    """通过 SSE 广播日志增量"""
    try:
        from app.api.eval import SSEManager
        await SSEManager.broadcast(task_id, "logs", {
            "logs": new_logs,
            "incremental": True
        })
        logger.info(f"SSE 广播日志增量成功: task_id={task_id}, {len(new_logs)} bytes")
    except Exception as e:
        logger.warning(f"广播日志增量失败: {e}")


class EvalScopeRunner:
    """EvalScope 评测执行器"""

    def __init__(self, progress_callback: Optional[Callable] = None, task_id: Optional[int] = None):
        """
        初始化执行器

        Args:
            progress_callback: 进度回调函数，签名: (progress: int, message: str) -> None
            task_id: 任务 ID，用于 cancel 信号查找
        """
        self.progress_callback = progress_callback
        self.task_id = task_id
        self._process = None  # 评测子进程
        self._pid = None  # 子进程 PID
        self._cancel_requested = False

    def cancel(self):
        """强制取消当前评测任务"""
        self._cancel_requested = True
        if self._pid:
            import signal
            try:
                logger.info(f"正在终止评测进程: task_id={self.task_id}, pid={self._pid}")
                os.kill(self._pid, signal.SIGTERM)
                # 等待进程结束
                import time
                for _ in range(10):
                    try:
                        os.kill(self._pid, 0)  # 检查进程是否存在
                        time.sleep(0.5)
                    except OSError:
                        break
                else:
                    # 进程还在，强制 kill
                    logger.warning(f"进程未响应 terminate，强制 kill: pid={self._pid}")
                    os.kill(self._pid, signal.SIGKILL)
            except ProcessLookupError:
                pass  # 进程已经不存在
            except Exception as e:
                logger.warning(f"终止进程失败: {e}")
        logger.info(f"评测任务已取消: task_id={self.task_id}")

    def is_cancelled(self) -> bool:
        """检查当前 runner 是否已收到取消请求。"""
        return self._cancel_requested

    async def run_evaluation(
        self,
        model_name: str,
        model_type: str,
        model_url: Optional[str],
        model_key: Optional[str],
        datasets: list,
        generation_config: Dict[str, Any],
        limit: Optional[int] = None,
        dataset_args: Dict[str, Any] = None,
        task_id: Optional[int] = None,
        task_uuid: Optional[str] = None,
        engine: Optional[str] = None,
        eval_batch_size: int = 1,
        use_cache: Optional[str] = None,
        rerun_review: bool = False,
        **kwargs
    ) -> EvalResult:
        """
        执行评测任务

        Args:
            model_name: 模型名称
            model_type: 模型类型 (openai_api, llm_ckpt, etc.)
            model_url: API URL (对于远程模型)
            model_key: API Key
            datasets: 数据集列表
            generation_config: 生成配置
            limit: 样本数限制
            dataset_args: 数据集参数
            eval_batch_size: 并发评测数量 (1-10)
            use_cache: 断点续测，指定之前的工作目录
            rerun_review: 是否重新执行 review

        Returns:
            EvalResult: 评测结果
        """
        start_time = time.time()
        dataset_args = dataset_args or {}

        try:
            self._report_progress(10, "正在初始化评测环境...")

            # 导入 EvalScope 组件
            from evalscope.config import TaskConfig
            from evalscope.api.registry import get_benchmark
            from evalscope.report import Report

            self._report_progress(20, "正在加载模型...")

            # 构建任务配置
            # 输出目录：
            # - 断点续测时：使用 use_cache 指定的目录
            # - 新评测时：outputs/{timestamp}
            if use_cache:
                # 断点续测：使用之前的工作目录
                work_dir = use_cache
            else:
                # 新评测：创建新的输出目录
                from app.core.config import settings
                from app.core.output_paths import build_run_directory_name

                run_name = build_run_directory_name()
                work_dir = os.path.abspath(os.path.join(settings.EVALSCOPE_WORK_DIR, run_name))
            os.makedirs(work_dir, exist_ok=True)
            # 映射引擎名称到 EvalScope 常量
            # 前端使用小写（native, opencompass, vlmeval, rag_eval），
            # EvalScope 使用标题大小写（Native, OpenCompass, VLMEvalKit, RAGEval）
            ENGINE_MAP = {
                'native': 'Native',
                'opencompass': 'OpenCompass',
                'vlmeval': 'VLMEvalKit',
                'rag_eval': 'RAGEval',
            }
            eval_backend = ENGINE_MAP.get(engine, 'Native')

            # 判断是否需要沙箱（使用 registry 中的统一逻辑）
            from evalscope_wrapper.registry import EvalScopeRegistry
            need_sandbox = False
            sandbox_datasets = []
            for dataset_name in datasets:
                ds_info = EvalScopeRegistry.get_dataset_by_name(dataset_name)
                if ds_info and ds_info.get('need_sandbox'):
                    need_sandbox = True
                    sandbox_datasets.append(dataset_name)

            if need_sandbox:
                logger.info(f"评测将启用沙箱，数据集: {sandbox_datasets}")
            else:
                logger.info(f"评测不需要沙箱")

            # OpenCompass 引擎需要初始化 eval_config（避免 NoneType 错误）
            eval_config = {}
            if eval_backend == 'OpenCompass':
                logger.info("使用 OpenCompass 引擎，初始化 eval_config")
                eval_config = {}

            # 判断是否需要 LLM judge（评判模型）
            # 某些数据集（如 Minerva-Math、LongBench 等）使用 LLM 作为评判器
            JUDGE_REQUIRED_DATASETS = {
                'minerva_math', 'math', 'math_qa', 'math_500', 'olympiad_bench',
                'gsm8k_v', 'docmath', 'math_vista', 'math_verse', 'math_vision',
                'longbench_v2', 'simple_qa', 'chinese_simpleqa', 'general_qa',
                'arena_hard', 'alpaca_eval', 'frames', 'health_bench',
                'process_bench', 'tir_bench', 'poly_math',
            }
            need_judge = any(ds.lower() in JUDGE_REQUIRED_DATASETS for ds in datasets)

            # 准备 judge 模型配置（使用与评测相同的模型作为 judge）
            judge_model_args = {}
            judge_strategy = 'auto'
            if need_judge:
                if model_url and model_key:
                    judge_model_args = {
                        'model_id': model_name,
                        'api_url': model_url,
                        'api_key': model_key,
                        'generation_config': {
                            'temperature': 0.0,  # judge 使用 0 温度确保稳定
                            'max_tokens': 1024,
                        }
                    }
                    logger.info(f"启用 LLM judge，使用模型 {model_name} 作为评判器")
                else:
                    logger.warning(
                        f"数据集 {datasets} 需要 LLM judge，但未配置 api_url/api_key，"
                        "评测可能失败。请提供 API 配置或选择不需要 judge 的数据集。"
                    )

            config = TaskConfig(
                model=model_name,
                model_id=model_name,
                eval_type=model_type if model_type else 'openai_api',
                model_args={},
                api_url=model_url if model_url and model_url.strip() else None,
                api_key=model_key if model_key and model_key.strip() else None,
                datasets=datasets,
                dataset_args=dataset_args or {},
                generation_config=generation_config or {},
                limit=limit,
                work_dir=work_dir,
                eval_backend=eval_backend,
                eval_config=eval_config,  # 传入初始化的 eval_config
                eval_batch_size=eval_batch_size,
                use_cache=use_cache,
                rerun_review=rerun_review,
                no_timestamp=True,
                debug=False,
                use_sandbox=need_sandbox,  # 根据数据集类型决定是否启用沙箱
                judge_strategy=judge_strategy,
                judge_model_args=judge_model_args,  # 配置 LLM judge
            )

            # 生成实际执行的命令字符串，用于前端展示
            cmd_parts = ['evalscope']
            cmd_parts.append(f'--model {model_name}')
            cmd_parts.append(f'--model-id {model_name}')
            cmd_parts.append(f'--eval-type {model_type or "openai_api"}')
            if model_url:
                cmd_parts.append(f'--api-url "{model_url}"')
            if model_key:
                # 对 API Key 进行脱敏处理（只显示前4位和后4位）
                masked_key = f"{model_key[:4]}...{model_key[-4:]}" if len(model_key) > 8 else "****"
                cmd_parts.append(f'--api-key "{masked_key}"')
            cmd_parts.append(f'--datasets {" ".join(datasets)}')
            if limit:
                cmd_parts.append(f'--limit {limit}')
            cmd_parts.append(f'--work-dir "{work_dir}"')
            cmd_parts.append(f'--eval-backend {eval_backend}')
            cmd_parts.append(f'--eval-batch-size {eval_batch_size}')
            if need_sandbox:
                cmd_parts.append('--use-sandbox')  # 只在需要时添加沙箱配置
            if generation_config:
                gen_config_str = ' '.join([f'{k}={v}' for k, v in generation_config.items()])
                cmd_parts.append(f'--generation-config "{gen_config_str}"')

            actual_command = ' \\\n  '.join(cmd_parts)

            # 记录到日志
            logger.info(f"实际执行的命令:\n{actual_command}")

            # 保存命令字符串到任务对象（不保存到数据库的 logs 字段，避免混淆）
            # 命令将通过日志 API 单独返回
            self._actual_command = actual_command

            # 前置校验：API 类型模型必须提供 api_key
            eval_type = model_type if model_type else 'openai_api'
            if eval_type in ('openai_api', 'openai', 'chat_completion', 'anthropic_api') and not config.api_key:
                raise ValueError(
                    f"模型 {model_name} 的 API Key 未提供，请先在模型管理中添加 API Key，"
                    "或编辑任务参数后重新执行"
                )

            # 清除 evalscope 模型缓存，避免使用旧的缓存配置（如 base_url=None）
            try:
                from evalscope.api.model.model import ModelCache
                ModelCache._models.clear()
                logger.info("模型缓存已清除")
            except Exception as e:
                logger.warning(f"清除模型缓存失败: {e}")

            self._report_progress(40, "正在执行评测...")

            if self.task_id:
                from app.services.task_state import update_task_state
                await update_task_state(self.task_id, output_dir=work_dir)

            # 使用子进程运行评测，支持强制取消
            import multiprocessing

            # 创建队列用于进程间通信
            result_queue = multiprocessing.Queue()

            # 启动子进程
            self._process = multiprocessing.Process(
                target=run_eval_subprocess,
                args=(config, result_queue)
            )
            self._process.start()
            self._pid = self._process.pid
            logger.info(f"评测进程已启动: task_id={self.task_id}, pid={self._pid}")

            # 等待进程完成，同时定期推送日志增量
            log_file_path = os.path.join(work_dir, 'logs', 'eval_log.log')
            logger.info(f"日志增量推送启动: log_file_path={log_file_path}, abs={os.path.abspath(log_file_path)}")
            last_log_offset = 0
            result_data = None
            while self._process.is_alive():
                if result_data is None:
                    try:
                        result_data = result_queue.get_nowait()
                    except Empty:
                        pass
                # 读取并推送日志增量
                new_logs, last_log_offset = _read_log_increment(log_file_path, last_log_offset)
                if new_logs and self.task_id:
                    logger.info(f"推送日志增量: {len(new_logs)} bytes, offset={last_log_offset}")
                    await _broadcast_log_increment(self.task_id, new_logs)
                # 等待 2 秒后再次检查
                await asyncio.sleep(2)

            # 进程已退出，推送最后一批日志
            new_logs, last_log_offset = _read_log_increment(log_file_path, last_log_offset)
            if new_logs and self.task_id:
                await _broadcast_log_increment(self.task_id, new_logs)

            # 确保子进程资源回收
            self._process.join()
            if self.is_cancelled():
                duration = time.time() - start_time
                logger.info(f"评测任务已被取消: task_id={self.task_id}")
                return EvalResult(
                    success=False,
                    error="评测任务已取消",
                    duration=duration
                )

            # 获取结果。Queue.empty() 在多进程下不可靠。
            if result_data is None:
                try:
                    result_data = result_queue.get(timeout=2)
                except Empty:
                    result_data = None

            if result_data is not None:
                if self.task_id and result_data.get('logs'):
                    from app.services.task_state import append_task_logs
                    await append_task_logs(self.task_id, result_data['logs'])
                if result_data.get('error'):
                    duration = time.time() - start_time
                    return EvalResult(
                        success=False,
                        error=result_data['error'],
                        duration=duration
                    )
            else:
                return EvalResult(
                    success=False,
                    error="评测进程无返回结果",
                    duration=time.time() - start_time,
                    output_dir=work_dir,
                )

            self._report_progress(90, "正在生成报告...")

            # 处理报告结果
            result_dict, all_scores, all_metrics, error_hint = _process_report_result({}, work_dir)

            duration = time.time() - start_time
            final_score = sum(all_scores) / len(all_scores) if all_scores else result_dict.get('score', 0.0)
            self._report_progress(100, "评测完成")

            return EvalResult(
                success=True,
                score=final_score,
                metrics=all_metrics,
                error=error_hint,
                duration=duration,
                output_dir=work_dir
            )

        except Exception as e:
            duration = time.time() - start_time
            logger.error(f"评测执行失败: {e}", exc_info=True)

            return EvalResult(
                success=False,
                error=str(e),
                duration=duration
            )

    def _report_progress(self, progress: int, message: str):
        """
        报告进度 - 同时更新数据库和 SSE 推送

        Args:
            progress: 进度 (0-100)
            message: 进度消息
        """
        if self.is_cancelled():
            logger.info(f"评测任务已取消，忽略进度报告: {progress}% - {message}")
            return

        # The callback owns persistence and SSE delivery.
        if self.progress_callback:
            try:
                self.progress_callback(progress, message)
            except Exception as e:
                logger.warning(f"进度回调失败: {e}")

        logger.info(f"评测进度: {progress}% - {message}")


# 运行实例管理：支持多任务并行 + 取消信号
_runner_instance: Optional['EvalScopeRunner'] = None  # 向后兼容：无 task_id 时的单例
_runner_registry: Dict[int, 'EvalScopeRunner'] = {}


def get_runner(progress_callback: Optional[Callable] = None, task_id: Optional[int] = None) -> EvalScopeRunner:
    """
    获取或创建执行器实例

    Args:
        progress_callback: 进度回调
        task_id: 任务 ID，用于唯一标识 runner 实例

    Returns:
        EvalScopeRunner 实例
    """
    if task_id is None:
        # 向后兼容：无 task_id 时使用单例
        global _runner_instance
        _runner_instance = getattr(get_runner, '_runner_instance', None)
        if _runner_instance is None:
            _runner_instance = EvalScopeRunner(progress_callback)
            get_runner._runner_instance = _runner_instance
        elif progress_callback is not None:
            _runner_instance.progress_callback = progress_callback
        return _runner_instance

    if task_id not in _runner_registry:
        _runner_registry[task_id] = EvalScopeRunner(progress_callback, task_id=task_id)
    elif progress_callback is not None:
        _runner_registry[task_id].progress_callback = progress_callback

    return _runner_registry[task_id]


def cancel_runner(task_id: int):
    """
    取消指定任务的 runner

    Args:
        task_id: 任务 ID
    """
    if task_id in _runner_registry:
        _runner_registry[task_id].cancel()
        logger.info(f"已请求取消任务 {task_id} 的评测")
    else:
        logger.warning(f"未找到任务 {task_id} 的 runner 实例")


def cleanup_runner(task_id: int):
    """
    清理指定任务的 runner 实例

    Args:
        task_id: 任务 ID
    """
    _runner_registry.pop(task_id, None)
