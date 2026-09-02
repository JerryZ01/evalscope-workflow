"""Centralized persistence for evaluation task execution state."""
from datetime import datetime
from typing import Any

from sqlalchemy import select

from app.db.database import async_session_maker
from app.db.models import EvaluationTask, TaskStatus


_UNSET = object()
_TERMINAL_STATUSES = {TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED}


async def update_task_state(
    task_id: int | None,
    *,
    status: TaskStatus | str | None = None,
    progress: int | None = None,
    current_step: str | None = None,
    results: Any = _UNSET,
    output_dir: Any = _UNSET,
    report_path: Any = _UNSET,
    logs: Any = _UNSET,
    error: Any = _UNSET,
    reset_timing: bool = False,
) -> bool:
    """Update a task through the configured SQLAlchemy session factory."""
    if task_id is None:
        return False

    normalized_status = TaskStatus(status) if isinstance(status, str) else status
    now = datetime.utcnow()

    async with async_session_maker() as session:
        result = await session.execute(
            select(EvaluationTask).where(EvaluationTask.id == task_id)
        )
        task = result.scalar_one_or_none()
        if task is None:
            return False

        if reset_timing:
            task.started_at = None
            task.completed_at = None
            task.duration = None

        if normalized_status is not None:
            task.status = normalized_status
            if normalized_status == TaskStatus.RUNNING and task.started_at is None:
                task.started_at = now
            if normalized_status in _TERMINAL_STATUSES:
                task.completed_at = now
                if task.started_at:
                    task.duration = (now - task.started_at).total_seconds()

        if progress is not None:
            task.progress = max(0, min(100, progress))
        if current_step is not None:
            task.current_step = current_step
        if results is not _UNSET:
            task.results = results
        if output_dir is not _UNSET:
            task.output_dir = output_dir
        if report_path is not _UNSET:
            task.report_path = report_path
        if logs is not _UNSET:
            task.logs = logs
        if error is not _UNSET:
            task.error = error

        await session.commit()
        return True


async def append_task_logs(task_id: int | None, content: str) -> bool:
    """Append captured output without bypassing the configured database."""
    if task_id is None or not content:
        return False

    async with async_session_maker() as session:
        result = await session.execute(
            select(EvaluationTask).where(EvaluationTask.id == task_id)
        )
        task = result.scalar_one_or_none()
        if task is None:
            return False
        task.logs = f"{task.logs or ''}{content}"
        await session.commit()
        return True


async def get_task_runtime_credentials(task_id: int | None) -> tuple[str | None, str | None]:
    """Load secrets just-in-time so they are never stored in workflow checkpoints."""
    if task_id is None:
        return None, None
    async with async_session_maker() as session:
        result = await session.execute(
            select(EvaluationTask.model_url, EvaluationTask.model_key).where(
                EvaluationTask.id == task_id
            )
        )
        row = result.one_or_none()
        return (row.model_url, row.model_key) if row else (None, None)
