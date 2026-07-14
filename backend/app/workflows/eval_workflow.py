"""
评测工作流 — LangGraph StateGraph 定义

工作流:
  START → prepare_config → validate_params → run_eval →
    → 成功 → collect_results → END
    → 失败 → diagnose_error → should_retry →
         → Yes → run_eval (重试)
         → No → END
"""
import asyncio
import logging
import multiprocessing
import os
import time
from typing import Literal

from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from app.core.config import settings
from app.db.models import TaskStatus
from app.services.task_state import (
    append_task_logs,
    get_task_runtime_credentials,
    update_task_state,
)
from app.workflows.state import EvalState

logger = logging.getLogger(__name__)

# ---- 子进程注册表（支持取消） ----

_eval_processes: dict[int, multiprocessing.Process] = {}


def register_eval_process(task_id: int, process: multiprocessing.Process):
    _eval_processes[task_id] = process


def cancel_eval_process(task_id: int):
    """取消评测子进程"""
    process = _eval_processes.pop(task_id, None)
    if process and process.is_alive():
        import signal
        try:
            os.kill(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        process.join(timeout=5)
        if process.is_alive():
            process.kill()
            process.join()

# ---- Checkpoint 存储 ----

CHECKPOINT_DB_PATH = os.path.abspath(settings.WORKFLOW_CHECKPOINT_DB)

_checkpoint_saver = None
CHECKPOINT_SCHEMA_VERSION = "2"


async def get_checkpointer():
    """获取异步 SQLite checkpoint 存储（单例）"""
    global _checkpoint_saver
    if _checkpoint_saver is None:
        import aiosqlite
        os.makedirs(os.path.dirname(CHECKPOINT_DB_PATH), exist_ok=True)
        conn = await aiosqlite.connect(CHECKPOINT_DB_PATH)
        _checkpoint_saver = AsyncSqliteSaver(conn)
        await _checkpoint_saver.setup()
        await conn.execute(
            "CREATE TABLE IF NOT EXISTS workflow_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        )
        cursor = await conn.execute(
            "SELECT value FROM workflow_meta WHERE key='security_schema_version'"
        )
        row = await cursor.fetchone()
        await cursor.close()
        if row is None or row[0] != CHECKPOINT_SCHEMA_VERSION:
            await conn.execute("DELETE FROM checkpoints")
            await conn.execute("DELETE FROM writes")
            await conn.execute(
                "INSERT OR REPLACE INTO workflow_meta(key, value) VALUES(?, ?)",
                ("security_schema_version", CHECKPOINT_SCHEMA_VERSION),
            )
            await conn.commit()
            checkpoint_cursor = await conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            await checkpoint_cursor.fetchall()
            await checkpoint_cursor.close()
            await conn.execute("VACUUM")
            logger.warning("旧工作流 checkpoint 已清理，以移除历史敏感状态")
    return _checkpoint_saver


# ---- 节点函数 ----


def prepare_config(state: EvalState) -> dict:
    """构建评测配置，判断沙箱/judge 需求"""
    from evalscope_wrapper.registry import EvalScopeRegistry

    datasets = state.get("datasets", [])
    need_sandbox = False
    sandbox_datasets = []
    for ds_name in datasets:
        ds_info = EvalScopeRegistry.get_dataset_by_name(ds_name)
        if ds_info and ds_info.get("need_sandbox"):
            need_sandbox = True
            sandbox_datasets.append(ds_name)

    JUDGE_REQUIRED_DATASETS = {
        'minerva_math', 'math', 'math_qa', 'math_500', 'olympiad_bench',
        'gsm8k_v', 'docmath', 'math_vista', 'math_verse', 'math_vision',
        'longbench_v2', 'simple_qa', 'chinese_simpleqa', 'general_qa',
        'arena_hard', 'alpaca_eval', 'frames', 'health_bench',
        'process_bench', 'tir_bench', 'poly_math',
    }
    need_judge = any(ds.lower() in JUDGE_REQUIRED_DATASETS for ds in datasets)

    # 构建配置摘要供人工确认
    config_lines = [
        f"模型: {state.get('model_name', '')}",
        f"数据集: {', '.join(datasets)}",
        f"引擎: {state.get('engine', 'native')}",
    ]
    if need_sandbox:
        config_lines.append(f"沙箱: 需要（{', '.join(sandbox_datasets)}）")
    if need_judge:
        config_lines.append("LLM Judge: 需要")
    if state.get("limit"):
        config_lines.append(f"样本限制: {state['limit']}")

    return {
        "need_sandbox": need_sandbox,
        "sandbox_datasets": sandbox_datasets,
        "need_judge": need_judge,
        "config_summary": "\n".join(config_lines),
        "current_step": "配置已准备",
    }


def validate_params(state: EvalState) -> dict:
    """校验 API Key、模型连通性"""
    errors = []
    model_type = state.get("model_type", "openai_api")
    has_model_key = state.get("has_model_key", False)
    model_url = state.get("model_url")

    if model_type in ("openai_api", "openai", "chat_completion", "anthropic_api"):
        if not has_model_key:
            errors.append("API Key 未提供")
        if not model_url:
            errors.append("API URL 未提供")

    if errors:
        return {
            "eval_success": False,
            "eval_error": "; ".join(errors),
            "current_step": "参数校验失败",
        }

    return {"current_step": "参数校验通过"}


def await_confirmation(state: EvalState) -> dict:
    """One-time no-op node used as the human approval boundary."""
    return {"current_step": "配置已确认"}


def _run_eval_in_process(config, result_queue):
    """在子进程中运行评测，所有持久化由父进程负责。"""
    import sys
    import io

    old_stdout = sys.stdout
    old_stderr = sys.stderr
    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()

    try:
        sys.stdout = stdout_capture
        sys.stderr = stderr_capture

        from evalscope import run_task
        report = run_task(config)

        captured_logs = stdout_capture.getvalue() + stderr_capture.getvalue()

        if hasattr(report, "to_dict"):
            result = report.to_dict()
        elif isinstance(report, dict):
            result = dict(report)
        else:
            result = {
                "score": getattr(report, "score", 0.0) if hasattr(report, "score") else 0.0,
                "metrics": getattr(report, "metrics", []) if hasattr(report, "metrics") else [],
            }

        result_queue.put({"report": result, "error": None, "logs": captured_logs})

    except Exception as e:
        captured_logs = stdout_capture.getvalue() + stderr_capture.getvalue()
        error_logs = captured_logs + f"\n\n错误: {str(e)}\n"
        result_queue.put({"report": None, "error": str(e), "logs": error_logs})

    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr


async def run_eval(state: EvalState) -> dict:
    """执行评测（子进程 + SSE 推送）"""
    from evalscope.config import TaskConfig
    task_id = state.get("task_id")
    started_at = time.monotonic()
    model_url, model_key = await get_task_runtime_credentials(task_id)

    # 更新数据库状态为 RUNNING
    await _update_task_status(task_id, "running", "正在执行评测...")
    # SSE: 推送评测开始
    await _sse_broadcast(task_id, "progress", {"progress": 0, "current_step": "正在执行评测...", "status": "running"})

    # 构建输出目录
    from datetime import datetime
    use_cache = state.get("use_cache")
    if use_cache:
        work_dir = use_cache
    else:
        run_name = state.get("task_uuid") or datetime.now().strftime("%Y%m%d_%H%M%S")
        work_dir = os.path.abspath(os.path.join(settings.EVALSCOPE_WORK_DIR, run_name))

    os.makedirs(work_dir, exist_ok=True)
    await update_task_state(task_id, output_dir=work_dir)

    # 引擎映射
    ENGINE_MAP = {
        "native": "Native",
        "opencompass": "OpenCompass",
        "vlmeval": "VLMEvalKit",
        "rag_eval": "RAGEval",
    }
    eval_backend = ENGINE_MAP.get(state.get("engine", "native"), "Native")

    # judge 配置
    judge_model_args = {}
    judge_strategy = "auto"
    if state.get("need_judge") and model_url and model_key:
        judge_model_args = {
            "model_id": state["model_name"],
            "api_url": model_url,
            "api_key": model_key,
            "generation_config": {"temperature": 0.0, "max_tokens": 1024},
        }

    # eval_config
    eval_config = {}
    if eval_backend == "OpenCompass":
        eval_config = {}

    config = TaskConfig(
        model=state.get("model_name", ""),
        model_id=state.get("model_name", ""),
        eval_type=state.get("model_type", "openai_api"),
        model_args={},
        api_url=model_url or None,
        api_key=model_key or None,
        datasets=state.get("datasets", []),
        dataset_args=state.get("dataset_args") or {},
        generation_config=state.get("generation_config") or {},
        limit=state.get("limit"),
        work_dir=work_dir,
        eval_backend=eval_backend,
        eval_config=eval_config,
        eval_batch_size=state.get("eval_batch_size", 3),
        use_cache=use_cache,
        rerun_review=state.get("rerun_review", False),
        no_timestamp=True,
        debug=False,
        use_sandbox=state.get("need_sandbox", False),
        judge_strategy=judge_strategy,
        judge_model_args=judge_model_args,
    )

    # 清除模型缓存
    try:
        from evalscope.api.model.model import ModelCache
        ModelCache._models.clear()
    except Exception:
        pass

    # 子进程执行评测
    result_queue = multiprocessing.Queue()
    process = multiprocessing.Process(
        target=_run_eval_in_process,
        args=(config, result_queue),
    )
    process.start()
    logger.info(f"评测进程已启动: task_id={task_id}, pid={process.pid}")

    # 注册子进程（支持取消）
    if task_id:
        register_eval_process(task_id, process)

    # 带日志增量推送的等待循环
    try:
        from evalscope_wrapper.runner import _read_log_increment
        log_file_path = os.path.join(work_dir, 'logs', 'eval_log.log')
        last_log_offset = 0
        while process.is_alive():
            new_logs, last_log_offset = _read_log_increment(log_file_path, last_log_offset)
            if new_logs and task_id:
                await _sse_broadcast(task_id, "logs", {"logs": new_logs, "incremental": True})
            await asyncio.sleep(2)
        # 进程退出后推送最后一批日志
        new_logs, last_log_offset = _read_log_increment(log_file_path, last_log_offset)
        if new_logs and task_id:
            await _sse_broadcast(task_id, "logs", {"logs": new_logs, "incremental": True})
    except asyncio.CancelledError:
        cancel_eval_process(task_id)
        raise
    except Exception:
        # 如果日志增量读取失败，降级为简单等待
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, process.join)

    finally:
        if process.is_alive():
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, process.join)
        else:
            process.join()
        _eval_processes.pop(task_id, None)

    # 获取结果
    if not result_queue.empty():
        result_data = result_queue.get()
    else:
        result_data = {"report": None, "error": "评测进程无返回结果", "logs": ""}

    await append_task_logs(task_id, result_data.get("logs", ""))

    if result_data.get("error"):
        return {
            "eval_success": False,
            "eval_error": result_data["error"],
            "work_dir": work_dir,
            "output_dir": work_dir,
            "eval_duration": time.monotonic() - started_at,
            "current_step": "评测执行失败",
        }

    # 处理报告结果
    report = result_data.get("report")
    result_dict, all_scores, all_metrics, error_hint = _process_report_result(report, work_dir)

    final_score = sum(all_scores) / len(all_scores) if all_scores else result_dict.get("score", 0.0)

    return {
        "eval_success": True,
        "eval_score": final_score,
        "eval_metrics": all_metrics,
        "work_dir": work_dir,
        "output_dir": work_dir,
        "eval_error": error_hint,
        "eval_duration": time.monotonic() - started_at,
        "current_step": "评测执行完成",
    }


async def collect_results(state: EvalState) -> dict:
    """收集结果并更新任务状态"""
    task_id = state.get("task_id")
    score = state.get("eval_score", 0.0)

    await update_task_state(
        task_id,
        status=TaskStatus.COMPLETED,
        progress=100,
        current_step=f"评测完成，得分 {score:.4f}",
        results={"score": score, "metrics": state.get("eval_metrics", [])},
        output_dir=state.get("output_dir"),
        error=state.get("eval_error"),
    )

    # SSE: 推送完成通知
    await _sse_broadcast(
        task_id, "complete",
        {"status": "completed", "progress": 100, "current_step": f"评测完成，得分 {score:.4f}", "score": score},
    )

    return {"current_step": f"评测完成，得分 {score:.4f}"}


def diagnose_error(state: EvalState) -> dict:
    """诊断评测失败原因"""
    error = state.get("eval_error", "")
    work_dir = state.get("work_dir")

    diagnosis = _classify_error(error, work_dir)

    # This node is synchronous; the terminal node persists the final error.

    return {"diagnosis": diagnosis, "current_step": f"诊断: {diagnosis}"}


def should_retry(state: EvalState) -> Literal["retry", "stop"]:
    """判断是否值得重试"""
    retry_count = state.get("retry_count", 0)
    max_retries = state.get("max_retries", 1)
    diagnosis = state.get("diagnosis", "")
    eval_error = state.get("eval_error", "")

    if retry_count >= max_retries:
        return "stop"

    # 可重试的错误类型
    retryable_keywords = [
        "connection", "timeout", "rate_limit", "429", "503", "502",
        "临时", "网络", "超时", "重试", "不可达", "超限",
    ]
    error_lower = f"{diagnosis} {eval_error}".lower()
    if any(kw in error_lower for kw in retryable_keywords):
        return "retry"

    return "stop"


async def mark_failed(state: EvalState) -> dict:
    """标记任务失败"""
    task_id = state.get("task_id")
    error = state.get("eval_error", "")
    await update_task_state(
        task_id,
        status=TaskStatus.FAILED,
        current_step="评测失败",
        error=error,
        output_dir=state.get("output_dir"),
    )

    # SSE: 推送失败通知
    await _sse_broadcast(
        task_id, "complete",
        {"status": "failed", "progress": 0, "current_step": "评测失败", "error": error},
    )

    return {"current_step": "评测失败"}


def increment_retry(state: EvalState) -> dict:
    """增加重试计数，启用断点续测"""
    work_dir = state.get("work_dir") or state.get("output_dir")
    return {
        "retry_count": state.get("retry_count", 0) + 1,
        "use_cache": work_dir,
        "rerun_review": False,
        "current_step": f"准备重试（第 {state.get('retry_count', 0) + 1} 次）",
    }


# ---- 辅助函数 ----


def _classify_error(error: str, work_dir: str | None) -> str:
    """分类错误原因"""
    if not error:
        return "未知错误"

    error_lower = error.lower()

    if any(kw in error_lower for kw in ["authorization", "auth", "401", "403", "api_key", "api key", "key"]):
        return "API 密钥无效或过期"
    if any(kw in error_lower for kw in ["connection", "connect", "timeout", "erefused", "unreachable"]):
        return "模型 API 不可达"
    if any(kw in error_lower for kw in ["429", "rate_limit", "rate limit", "too many"]):
        return "API 调用频率超限"
    if any(kw in error_lower for kw in ["sandbox", "沙箱", "docker"]):
        return "沙箱环境未就绪"
    if any(kw in error_lower for kw in ["not found", "未找到", "no such"]):
        return "数据集或模型未找到"
    if any(kw in error_lower for kw in ["oom", "out of memory", "内存"]):
        return "内存不足"

    return f"其他错误: {error[:100]}"


def _process_report_result(report, work_dir: str | None) -> tuple:
    """处理评测报告结果（复用 runner.py 逻辑）"""
    from evalscope_wrapper.runner import _process_report_result as _orig_process
    return _orig_process(report, work_dir)


async def _update_task_status(task_id: int | None, status: str, step: str):
    """更新任务状态到配置的业务数据库。"""
    await update_task_state(task_id, status=status, current_step=step)


async def _sse_broadcast(task_id: int | None, event_type: str, data: dict):
    """通过 SSEManager 广播事件"""
    if not task_id:
        return
    try:
        from app.api.eval import SSEManager
        await SSEManager.broadcast(task_id, event_type, data)
    except Exception as e:
        logger.debug(f"SSE 广播失败: {e}")


# ---- 构建工作流 ----


async def build_eval_workflow():
    """构建评测工作流 StateGraph"""
    workflow = StateGraph(EvalState)

    # 添加节点
    workflow.add_node("prepare_config", prepare_config)
    workflow.add_node("validate_params", validate_params)
    workflow.add_node("await_confirmation", await_confirmation)
    workflow.add_node("run_eval", run_eval)
    workflow.add_node("collect_results", collect_results)
    workflow.add_node("diagnose_error", diagnose_error)
    workflow.add_node("mark_failed", mark_failed)
    workflow.add_node("increment_retry", increment_retry)

    # 添加边
    workflow.add_edge(START, "prepare_config")
    workflow.add_edge("prepare_config", "validate_params")

    # validate_params: 校验失败 → 诊断 → 结束；校验通过 → 执行评测
    workflow.add_conditional_edges(
        "validate_params",
        lambda state: "await_confirmation" if state.get("eval_success", True) else "diagnose_error",
        {"await_confirmation": "await_confirmation", "diagnose_error": "diagnose_error"},
    )
    workflow.add_edge("await_confirmation", "run_eval")

    # run_eval: 成功 → 收集结果；失败 → 诊断
    workflow.add_conditional_edges(
        "run_eval",
        lambda state: "collect_results" if state.get("eval_success") else "diagnose_error",
        {"collect_results": "collect_results", "diagnose_error": "diagnose_error"},
    )

    workflow.add_edge("collect_results", END)

    # diagnose_error → should_retry (条件路由，不是节点)
    workflow.add_conditional_edges(
        "diagnose_error",
        should_retry,
        {"retry": "increment_retry", "stop": "mark_failed"},
    )

    workflow.add_edge("increment_retry", "run_eval")
    workflow.add_edge("mark_failed", END)

    # 编译（带 checkpoint 和 interrupt）
    checkpointer = await get_checkpointer()

    return workflow.compile(
        checkpointer=checkpointer,
        interrupt_before=["await_confirmation"],
    )


# ---- 工作流实例管理 ----

_active_workflows: dict = {}


async def get_workflow():
    """获取工作流编译实例（单例）"""
    if "graph" not in _active_workflows:
        _active_workflows["graph"] = await build_eval_workflow()
    return _active_workflows["graph"]
