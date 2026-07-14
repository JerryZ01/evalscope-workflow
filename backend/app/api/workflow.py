"""
评测工作流 API — 启动/确认/取消/状态查询
"""
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db.models import EvaluationTask, TaskStatus
from app.workflows.eval_workflow import get_workflow
from app.workflows.state import EvalState
from app.core.config import settings
from app.services.task_state import update_task_state

router = APIRouter()
logger = logging.getLogger(__name__)
_workflow_tasks: dict[int, asyncio.Task] = {}


class ConfirmRequest(BaseModel):
    """确认请求（可携带修改后的配置）"""
    approved: bool = True
    modifications: Optional[dict] = None


@router.post("/{task_id}/start")
async def start_workflow(
    task_id: int,
    db: AsyncSession = Depends(get_db),
):
    """启动评测工作流"""
    # 查找任务
    result = await db.execute(
        select(EvaluationTask).where(EvaluationTask.id == task_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    if task.status == TaskStatus.RUNNING:
        raise HTTPException(status_code=400, detail="任务已在运行中")

    # 构建初始状态
    gen_config = task.generation_config or {}
    initial_state: EvalState = {
        "task_id": task.id,
        "task_uuid": task.task_uuid,
        "task_name": task.name,
        "model_name": task.model_name,
        "model_type": task.model_type,
        "model_url": task.model_url,
        "has_model_key": bool(task.model_key),
        "generation_config": gen_config,
        "datasets": task.datasets or [],
        "dataset_args": task.dataset_args or {},
        "limit": task.limit,
        "eval_batch_size": task.eval_batch_size,
        "engine": task.engine or "native",
        "use_cache": task.use_cache,
        "rerun_review": task.rerun_review,
        "retry_count": 0,
        "max_retries": 1,
        "current_step": "初始化",
    }

    # 获取工作流
    graph = await get_workflow()
    delete_thread = getattr(graph.checkpointer, "adelete_thread", None)
    if delete_thread:
        await delete_thread(str(task_id))

    # 配置（含 Langfuse handler）
    config = {
        "configurable": {"thread_id": str(task_id)},
        "recursion_limit": 20,
    }

    if settings.LANGFUSE_PUBLIC_KEY and settings.LANGFUSE_SECRET_KEY:
        try:
            from langfuse.langchain import CallbackHandler
            handler = CallbackHandler()
            config["callbacks"] = [handler]
            config["metadata"] = {
                "langfuse_trace_name": f"评测工作流: {task.name}",
                "langfuse_tags": ["eval-workflow"],
            }
        except Exception as e:
            logger.warning(f"Langfuse handler 初始化失败: {e}")

    # 重置任务状态
    task.status = TaskStatus.PENDING
    task.progress = 0
    task.error = None
    task.results = None
    task.current_step = "工作流启动中"
    await db.commit()

    # 异步启动工作流（在后台执行到 interrupt_before 为止）
    # 执行工作流（会在 interrupt_before=["run_eval"] 处暂停）
    try:
        result = await graph.ainvoke(initial_state, config=config)
    except Exception as e:
        logger.error(f"工作流执行异常: {e}", exc_info=True)
        await _update_task_status(db, task_id, "failed", str(e))
        raise HTTPException(status_code=500, detail=f"工作流执行失败: {str(e)}")

    # 检查是否在 interrupt 处暂停
    state = await graph.aget_state(config)
    if state.next:
        step_name = state.next[0] if state.next else "unknown"
        await _update_task_step(db, task_id, f"等待确认: {step_name}")
    else:
        logger.info(f"工作流已完成: task_id={task_id}")

    return {
        "status": "started",
        "task_id": task_id,
        "message": "工作流已启动，正在准备配置...",
    }


@router.get("/{task_id}/status")
async def workflow_status(
    task_id: int,
    db: AsyncSession = Depends(get_db),
):
    """查询工作流状态"""
    task_result = await db.execute(
        select(EvaluationTask.id).where(EvaluationTask.id == task_id)
    )
    if task_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="任务不存在")

    graph = await get_workflow()
    config = {"configurable": {"thread_id": str(task_id)}}

    try:
        state = await graph.aget_state(config)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取工作流状态失败: {str(e)}")

    # 判断当前状态
    waiting_for_confirmation = False
    next_step = None
    if state.next and state.next[0] == "await_confirmation":
        next_step = state.next[0]
        waiting_for_confirmation = True

    # 提取工作流状态中的关键字段
    values = state.values or {}
    config_summary = values.get("config_summary", "")
    current_step = values.get("current_step", "")
    diagnosis = values.get("diagnosis", "")
    retry_count = values.get("retry_count", 0)

    return {
        "task_id": task_id,
        "waiting_for_confirmation": waiting_for_confirmation,
        "next_step": next_step,
        "current_step": current_step,
        "config_summary": config_summary,
        "diagnosis": diagnosis,
        "retry_count": retry_count,
        "eval_success": values.get("eval_success"),
        "eval_score": values.get("eval_score"),
        "eval_error": values.get("eval_error"),
    }


@router.post("/{task_id}/confirm", status_code=202)
async def confirm_workflow(
    task_id: int,
    req: ConfirmRequest = ConfirmRequest(),
    db: AsyncSession = Depends(get_db),
):
    """确认继续工作流（人工确认节点）"""
    graph = await get_workflow()
    config: dict = {"configurable": {"thread_id": str(task_id)}}

    # Langfuse callback（confirm 阶段执行实际评测，需要追踪）
    if settings.LANGFUSE_PUBLIC_KEY and settings.LANGFUSE_SECRET_KEY:
        try:
            from langfuse.langchain import CallbackHandler
            handler = CallbackHandler()
            config["callbacks"] = [handler]
            config["metadata"] = {
                "langfuse_trace_name": f"评测执行: task_{task_id}",
                "langfuse_tags": ["eval-workflow", "eval-execution"],
            }
        except Exception as e:
            logger.warning(f"Langfuse handler 初始化失败: {e}")

    # 检查是否在等待确认
    state = await graph.aget_state(config)
    if not state.next or state.next[0] != "await_confirmation":
        raise HTTPException(status_code=400, detail="工作流未在等待确认")

    if not req.approved:
        # 用户拒绝，取消工作流
        await _update_task_status(db, task_id, "cancelled", "用户取消")
        return {"status": "cancelled", "task_id": task_id}

    # 应用修改（如有）
    if req.modifications:
        allowed_modifications = {
            "generation_config", "dataset_args", "limit", "eval_batch_size"
        }
        invalid_fields = set(req.modifications) - allowed_modifications
        if invalid_fields:
            raise HTTPException(
                status_code=400,
                detail=f"不允许修改工作流字段: {', '.join(sorted(invalid_fields))}",
            )
        await graph.aupdate_state(config, req.modifications)

    # 更新任务状态
    await _update_task_status(db, task_id, "running", "评测执行中")

    from langgraph.types import Command

    existing = _workflow_tasks.get(task_id)
    if existing and not existing.done():
        raise HTTPException(status_code=409, detail="工作流已在后台执行")

    background_task = asyncio.create_task(
        _continue_workflow(task_id, graph, config, Command(resume=True))
    )
    _workflow_tasks[task_id] = background_task

    return {"status": "confirmed", "task_id": task_id, "message": "评测已开始执行"}


@router.post("/{task_id}/cancel")
async def cancel_workflow(
    task_id: int,
    db: AsyncSession = Depends(get_db),
):
    """取消工作流"""
    background_task = _workflow_tasks.pop(task_id, None)
    if background_task and not background_task.done():
        background_task.cancel()

    # 取消评测子进程
    from app.workflows.eval_workflow import cancel_eval_process
    cancel_eval_process(task_id)
    from evalscope_wrapper.runner import cancel_runner
    cancel_runner(task_id)

    # 更新任务状态
    await _update_task_status(db, task_id, "cancelled", "工作流已取消")

    return {"status": "cancelled", "task_id": task_id}


# ---- 辅助函数 ----


async def _update_task_status(db: AsyncSession, task_id: int, status: str, step: str):
    """Update status through the central task state service."""
    await update_task_state(task_id, status=status, current_step=step)


async def _continue_workflow(task_id: int, graph, config: dict, command) -> None:
    """Resume a confirmed graph outside the request lifecycle."""
    try:
        await graph.ainvoke(command, config=config)
        logger.info("工作流后台执行完成: task_id=%s", task_id)
    except asyncio.CancelledError:
        logger.info("工作流后台任务已取消: task_id=%s", task_id)
        raise
    except Exception as exc:
        logger.error("工作流后台执行异常: task_id=%s", task_id, exc_info=True)
        await update_task_state(
            task_id,
            status=TaskStatus.FAILED,
            current_step="工作流执行失败",
            error=str(exc),
        )
    finally:
        current = _workflow_tasks.get(task_id)
        if current is asyncio.current_task():
            _workflow_tasks.pop(task_id, None)


async def _update_task_step(db: AsyncSession, task_id: int, step: str):
    """Update the current step through the central task state service."""
    await update_task_state(task_id, current_step=step)
