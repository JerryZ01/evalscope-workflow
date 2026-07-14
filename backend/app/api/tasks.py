"""
任务管理 API 路由
"""
import logging
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db.models import EvaluationTask, TaskStatus, User
from app.schemas.task import (
    TaskCreateSchema,
    TaskUpdateSchema,
    TaskListItemSchema,
    TaskDetailSchema,
    TaskCreateResponseSchema,
    TaskActionResponse,
    TaskDeleteResponse
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("", response_model=TaskCreateResponseSchema, status_code=status.HTTP_201_CREATED)
async def create_task(
    task_data: TaskCreateSchema,
    db: AsyncSession = Depends(get_db)
):
    """
    创建新的评测任务
    """
    from app.db.models import ManagedModel

    # 如果没有提供 model_url 或 model_key，尝试从模型管理表获取
    model_url = task_data.model_url
    model_key = task_data.model_key
    model_type = task_data.model_type
    generation_config = task_data.generation_config

    if not model_url or not model_key:
        # 查找模型管理表中是否有该模型
        result = await db.execute(
            select(ManagedModel).where(ManagedModel.model_name == task_data.model_name)
        )
        managed_model = result.scalar_one_or_none()

        if managed_model:
            if not model_url and managed_model.api_url:
                model_url = managed_model.api_url
            if not model_key and managed_model.api_key:
                model_key = managed_model.api_key
            if not model_type or model_type == "openai_api":
                model_type = managed_model.model_type
            # 合并生成配置
            if managed_model.generation_config:
                merged_config = dict(managed_model.generation_config)
                merged_config.update(generation_config)
                generation_config = merged_config

    # 创建任务记录
    task = EvaluationTask(
        name=task_data.name,
        description=task_data.description,
        model_name=task_data.model_name,
        model_type=model_type,
        model_url=model_url,
        model_key=model_key,
        generation_config=generation_config,
        datasets=task_data.datasets,
        dataset_args=task_data.dataset_args,
        limit=task_data.limit,
        eval_batch_size=task_data.eval_batch_size,
        engine=task_data.engine or "native",
        status=TaskStatus.PENDING,
        progress=0
    )

    db.add(task)
    await db.commit()
    await db.refresh(task)

    return TaskCreateResponseSchema(
        id=task.id,
        task_uuid=task.task_uuid,
        name=task.name,
        status=task.status,
        message="任务创建成功"
    )


@router.get("", response_model=List[TaskListItemSchema])
async def list_tasks(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    status_filter: Optional[TaskStatus] = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db)
):
    """
    获取任务列表（支持分页和状态筛选）
    """
    query = select(EvaluationTask).order_by(EvaluationTask.created_at.desc())

    if status_filter:
        query = query.where(EvaluationTask.status == status_filter)

    query = query.offset(skip).limit(limit)

    result = await db.execute(query)
    tasks = result.scalars().all()

    return [TaskListItemSchema.model_validate(task) for task in tasks]


@router.get("/{task_id}", response_model=TaskDetailSchema)
async def get_task(
    task_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    获取任务详情
    """
    result = await db.execute(
        select(EvaluationTask).where(EvaluationTask.id == task_id)
    )
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"任务 {task_id} 不存在"
        )

    return TaskDetailSchema.model_validate(task)


@router.patch("/{task_id}", response_model=TaskDetailSchema)
async def update_task(
    task_id: int,
    task_data: TaskUpdateSchema,
    db: AsyncSession = Depends(get_db)
):
    """
    更新任务信息
    """
    result = await db.execute(
        select(EvaluationTask).where(EvaluationTask.id == task_id)
    )
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"任务 {task_id} 不存在"
        )

    # 状态检查：运行中的任务无法修改（已完成、失败、已暂停等均可修改）
    if task.status == TaskStatus.RUNNING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"状态为 {task.status.value} 的任务无法修改，请先停止任务"
        )

    # 只能更新部分字段
    update_data = task_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(task, field, value)

    task.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(task)

    return TaskDetailSchema.model_validate(task)


@router.delete("/{task_id}", response_model=TaskDeleteResponse)
async def delete_task(
    task_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    删除任务

    如果任务正在运行，先停止再删除
    """
    result = await db.execute(
        select(EvaluationTask).where(EvaluationTask.id == task_id)
    )
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"任务 {task_id} 不存在"
        )

    # 如果任务正在运行，先发送取消信号并等待 runner 退出
    if task.status == TaskStatus.RUNNING:
        try:
            from evalscope_wrapper.runner import cancel_runner, cleanup_runner
            from app.workflows.eval_workflow import cancel_eval_process
            cancel_runner(task_id)
            cancel_eval_process(task_id)
            # 先标记为 CANCELLED，让 runner 看到状态变化后能感知到
            task.status = TaskStatus.CANCELLED
            task.completed_at = datetime.utcnow()
            if task.started_at:
                task.duration = (task.completed_at - task.started_at).total_seconds()
            await db.commit()
            # 给子进程一点时间响应取消信号
            import asyncio
            await asyncio.sleep(0.5)
            cleanup_runner(task_id)
        except Exception as e:
            logger.warning(f"清理运行中的任务失败: {e}")

    await db.delete(task)
    await db.commit()

    return TaskDeleteResponse(
        id=task_id,
        message="任务删除成功"
    )


@router.post("/{task_id}/start", response_model=TaskActionResponse, deprecated=True)
async def start_task(
    task_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Compatibility endpoint delegating to the confirmation workflow."""
    from app.api.workflow import start_workflow

    await start_workflow(task_id, db)
    result = await db.execute(
        select(EvaluationTask).where(EvaluationTask.id == task_id)
    )
    task = result.scalar_one()

    return TaskActionResponse(
        id=task.id,
        status=task.status,
        message="评测工作流已启动，等待配置确认"
    )


@router.post("/{task_id}/stop", response_model=TaskActionResponse)
async def stop_task(
    task_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    停止任务

    先发送取消信号给 runner，再更新数据库状态，确保一致性
    """
    result = await db.execute(
        select(EvaluationTask).where(EvaluationTask.id == task_id)
    )
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"任务 {task_id} 不存在"
        )

    if task.status != TaskStatus.RUNNING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="只有运行中的任务才能停止"
        )

    # 先发送取消信号给 runner（确保 runner 能收到）
    try:
        from evalscope_wrapper.runner import cancel_runner
        from app.workflows.eval_workflow import cancel_eval_process
        cancel_runner(task_id)
        cancel_eval_process(task_id)
    except Exception as e:
        logger.warning(f"发送取消信号失败: {e}")

    # 再更新任务状态
    task.status = TaskStatus.CANCELLED
    task.current_step = "用户请求停止"
    task.completed_at = datetime.utcnow()

    if task.started_at:
        task.duration = (task.completed_at - task.started_at).total_seconds()

    await db.commit()
    await db.refresh(task)

    # 广播状态变化（让前端 SSE 即时感知）
    try:
        from app.api.eval import SSEManager
        await SSEManager.broadcast(task_id, "complete", {
            "status": "cancelled",
            "progress": task.progress,
            "current_step": "用户请求停止",
        })
    except Exception as e:
        logger.warning(f"SSE 广播失败: {e}")

    return TaskActionResponse(
        id=task.id,
        status=task.status,
        message="任务已停止"
    )


@router.post("/{task_id}/resume", response_model=TaskActionResponse)
async def resume_task(
    task_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    断点续测：从上次中断的位置继续评测

    设置 use_cache 指向之前的工作目录，EvalScope 会自动跳过已完成的样本
    """
    result = await db.execute(
        select(EvaluationTask).where(EvaluationTask.id == task_id)
    )
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"任务 {task_id} 不存在"
        )

    if task.status not in [TaskStatus.CANCELLED, TaskStatus.FAILED]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="只有已取消或失败的任务才能断点续测"
        )

    # 使用数据库中保存的输出目录
    if not task.output_dir:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="未找到之前的评测记录，无法断点续测"
        )

    import os
    if not os.path.exists(task.output_dir):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"评测输出目录不存在: {task.output_dir}"
        )

    # 设置 use_cache 并重置状态
    task.use_cache = task.output_dir
    task.rerun_review = False
    task.status = TaskStatus.PENDING
    task.progress = 0
    task.current_step = None
    task.error = None
    task.started_at = None
    task.completed_at = None

    await db.commit()
    await db.refresh(task)

    return TaskActionResponse(
        id=task.id,
        status=task.status,
        message=f"已设置断点续测，将从 {task.output_dir} 继续"
    )


@router.post("/{task_id}/retry", response_model=TaskActionResponse)
async def retry_task(
    task_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    重试任务
    """
    result = await db.execute(
        select(EvaluationTask).where(EvaluationTask.id == task_id)
    )
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"任务 {task_id} 不存在"
        )

    if task.status not in [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="只有已完成、失败或已取消的任务才能重试"
        )

    # 重置任务状态
    task.status = TaskStatus.PENDING
    task.progress = 0
    task.current_step = None
    task.error = None
    task.started_at = None
    task.completed_at = None

    await db.commit()
    await db.refresh(task)

    return TaskActionResponse(
        id=task.id,
        status=task.status,
        message="任务已重置，可以重新启动"
    )


@router.get("/{task_id}/status", response_model=TaskActionResponse)
async def get_task_status(
    task_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    获取任务状态（简化版）
    """
    result = await db.execute(
        select(EvaluationTask).where(EvaluationTask.id == task_id)
    )
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"任务 {task_id} 不存在"
        )

    return TaskActionResponse(
        id=task.id,
        status=task.status,
        message=f"当前进度: {task.progress}%"
    )
