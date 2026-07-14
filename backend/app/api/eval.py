"""
评测执行 API 路由
"""
import asyncio
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Optional, Callable, Dict, Set
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db.models import EvaluationTask, TaskStatus
from evalscope_wrapper.runner import EvalScopeRunner, get_runner, cancel_runner, cleanup_runner

logger = logging.getLogger(__name__)

router = APIRouter()

# SSE 连接管理
class SSEManager:
    """SSE 连接管理器"""
    _connections: Dict[int, Set[asyncio.Queue]] = defaultdict(set)

    @classmethod
    async def connect(cls, task_id: int) -> asyncio.Queue:
        """注册新的 SSE 连接"""
        queue = asyncio.Queue()
        cls._connections[task_id].add(queue)
        logger.info(f"SSE 连接已建立: task_id={task_id}, 当前连接数={len(cls._connections[task_id])}")
        return queue

    @classmethod
    async def disconnect(cls, task_id: int, queue: asyncio.Queue):
        """断开 SSE 连接"""
        cls._connections[task_id].discard(queue)
        logger.info(f"SSE 连接已断开: task_id={task_id}, 剩余连接数={len(cls._connections[task_id])}")

    @classmethod
    async def broadcast(cls, task_id: int, event_type: str, data: dict):
        """向所有连接广播消息（输出合法 SSE 帧）"""
        if task_id not in cls._connections or not cls._connections[task_id]:
            return

        # SSE 帧格式：event: <name>\ndata: <json>\n\n
        message = f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
        disconnected = set()

        for queue in cls._connections[task_id]:
            try:
                await queue.put(message)
            except Exception as e:
                logger.warning(f"发送 SSE 消息失败: {e}")
                disconnected.add(queue)

        # 清理断开的连接
        for q in disconnected:
            cls._connections[task_id].discard(q)


@router.post("/run/{task_id}", deprecated=True)
async def run_evaluation(
    task_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Compatibility endpoint; all execution now starts through the workflow."""
    from app.api.workflow import start_workflow

    await start_workflow(task_id, db)

    return {
        "message": "评测工作流已启动，等待配置确认",
        "task_id": task_id,
        "status": "pending_confirmation"
    }


async def run_evaluation_background(
    task_id: int,
    task_uuid: str,
    progress_callback: Optional[Callable] = None
):
    """后台执行评测任务（创建新的 db session）"""
    from app.db.database import async_session_maker
    import asyncio

    async with async_session_maker() as db:
        try:
            await execute_evaluation_task(
                task_id,
                task_uuid,
                db,
                progress_callback
            )
        except Exception as e:
            logger.error(f"后台评测任务执行失败: {e}")
            import traceback
            traceback.print_exc()


async def execute_evaluation_task(
    task_id: int,
    task_uuid: str,
    db: AsyncSession,
    progress_callback: Optional[Callable] = None
):
    """执行评测任务的异步函数"""
    from app.db.models import EvaluationTask

    try:
        # 从 DB 重新读取最新任务数据（避免使用 API 调用时捕获的旧值）
        result = await db.execute(
            select(EvaluationTask).where(EvaluationTask.id == task_id)
        )
        task = result.scalar_one_or_none()
        if not task:
            return

        model_name = task.model_name
        model_type = task.model_type
        model_url = task.model_url
        model_key = task.model_key
        generation_config = task.generation_config
        datasets = task.datasets
        limit = task.limit
        dataset_args = task.dataset_args or {}
        engine = task.engine or 'native'
        eval_batch_size = task.eval_batch_size or 1
        use_cache = task.use_cache
        rerun_review = task.rerun_review or False

        # 获取 runner 并设置进度回调（传入 task_id 支持取消）
        runner = get_runner(progress_callback, task_id=task_id)

        # 执行评测
        eval_result = await runner.run_evaluation(
            model_name=model_name,
            model_type=model_type,
            model_url=model_url,
            model_key=model_key,
            datasets=datasets,
            generation_config=generation_config,
            limit=limit,
            dataset_args=dataset_args,
            task_id=task_id,
            task_uuid=task_uuid,
            engine=engine,
            eval_batch_size=eval_batch_size,
            use_cache=use_cache,
            rerun_review=rerun_review,
        )

        # 获取任务并更新结果
        # 刷新 session 以获取最新数据
        await db.refresh(task) if task else None

        result = await db.execute(
            select(EvaluationTask).where(EvaluationTask.id == task_id)
        )
        task = result.scalar_one_or_none()

        if task:
            # 再次检查是否被取消（可能在评测过程中被取消）
            if task.status == TaskStatus.CANCELLED:
                logger.info(f"任务 {task_id} 已被用户取消，跳过结果处理")
                cleanup_runner(task_id)
                return

            # 判断是否真正成功
            # 1. success=True，无 error，且有有效分数/指标 → 成功
            # 2. success=True 但 score=0 且 metrics=[] → 实际失败（如 API key 缺失），fallback 文件也无结果
            # 3. success=False 或有 error → 明确失败
            is_real_success = (
                eval_result.success
                and eval_result.error is None
                and not (eval_result.score == 0.0 and not eval_result.metrics)
            )

            # 检查是否是取消导致的失败
            is_cancelled_error = eval_result.error and "取消" in eval_result.error
            logger.info(f"eval_result.success={eval_result.success}, error={eval_result.error}, is_cancelled_error={is_cancelled_error}")

            # 在更新前最后一次检查数据库状态
            fresh_result = await db.execute(
                select(EvaluationTask).where(EvaluationTask.id == task_id)
            )
            fresh_task = fresh_result.scalar_one_or_none()
            if fresh_task and fresh_task.status == TaskStatus.CANCELLED:
                logger.info(f"任务 {task_id} 已被用户取消（commit前检查），跳过结果处理")
                cleanup_runner(task_id)
                return

            if is_real_success:
                task.status = TaskStatus.COMPLETED
                task.progress = 100  # 显式设置为 100，避免停在 90%
                task.current_step = "评测完成"
                task.results = {
                    'score': eval_result.score,
                    'metrics': eval_result.metrics
                }
                task.output_dir = eval_result.output_dir
                await SSEManager.broadcast(task_id, "complete", {
                    "status": "completed",
                    "progress": 100,
                    "current_step": "评测完成",
                    "score": eval_result.score
                })
            elif is_cancelled_error:
                # 取消导致的失败，保持 CANCELLED 状态
                logger.info(f"任务 {task_id} 因取消而失败，保持 CANCELLED 状态")
                task.status = TaskStatus.CANCELLED
                task.current_step = "已取消"
                task.logs = eval_result.error
                task.output_dir = eval_result.output_dir
            else:
                logger.info(f"任务 {task_id} 评测失败: {eval_result.error}")
                error_msg = eval_result.error or (
                    "评测未产生有效结果（score=0，metrics=[]），"
                    "可能原因：API Key 缺失、模型配置错误或网络问题"
                )
                # 如果 runner 没有给出具体错误，追加通用提示
                if not eval_result.error:
                    error_msg += "，请查看日志获取详情"
                task.status = TaskStatus.FAILED
                task.current_step = f"失败: {error_msg}"
                task.logs = error_msg
                task.output_dir = eval_result.output_dir
                await SSEManager.broadcast(task_id, "complete", {
                    "status": "failed",
                    "progress": task.progress,
                    "current_step": task.current_step,
                    "error": error_msg
                })

            task.completed_at = datetime.utcnow()
            if task.started_at:
                task.duration = (task.completed_at - task.started_at).total_seconds()

            await db.commit()
            cleanup_runner(task_id)

    except Exception as e:
        logger.error(f"评测执行失败: {e}", exc_info=True)

        # 更新任务为失败状态
        try:
            result = await db.execute(
                select(EvaluationTask).where(EvaluationTask.id == task_id)
            )
            task = result.scalar_one_or_none()

            if task:
                task.status = TaskStatus.FAILED
                task.current_step = f"执行错误: {str(e)}"
                task.logs = str(e)
                task.completed_at = datetime.utcnow()
                if task.started_at:
                    task.duration = (task.completed_at - task.started_at).total_seconds()
                await db.commit()
        except Exception as update_error:
            logger.error(f"更新任务状态失败: {update_error}")
            # SSE 广播异常
            await SSEManager.broadcast(task_id, "complete", {
                "status": "failed",
                "error": str(e)
            })
        finally:
            cleanup_runner(task_id)


@router.get("/log/{task_id}")
async def get_evaluation_log(
    task_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    获取评测日志 - 同时从数据库和文件系统读取
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

    # 1. 优先从数据库读取日志（可能是错误信息）
    db_logs = task.logs or ""

    # 2. 尝试从文件系统读取日志
    file_logs = ""

    # 使用绝对路径 - 获取项目根目录（backend 的上级目录）
    project_root = Path(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

    # 优先使用 output_dir 字段，其次使用 task_uuid
    if task.output_dir:
        work_dir = project_root / task.output_dir.replace('../', '')
    else:
        work_dir = project_root / "outputs" / task.task_uuid

    if work_dir.exists():
        # 直接读取 work_dir/logs/eval_log.log（不是在子目录中找）
        log_file = work_dir / "logs" / "eval_log.log"
        if log_file.exists():
            try:
                file_logs = log_file.read_text(encoding='utf-8', errors='ignore')
                logger.info(f"读取日志文件成功: {log_file}, 大小: {len(file_logs)} bytes")
            except Exception as e:
                logger.warning(f"读取日志文件失败: {e}")
        else:
            logger.warning(f"日志文件不存在: {log_file}")
            # 尝试查找其他可能的日志位置
            try:
                # 查找所有包含 eval_log.log 的文件
                for log_path in work_dir.rglob("eval_log.log"):
                    file_logs = log_path.read_text(encoding='utf-8', errors='ignore')
                    logger.info(f"从备选位置读取日志: {log_path}, 大小: {len(file_logs)} bytes")
                    break
            except Exception as e:
                logger.warning(f"搜索日志文件失败: {e}")

    # 合并日志（文件系统日志优先，因为它更完整）
    combined_logs = file_logs or db_logs
    log_source = "file" if file_logs else ("db" if db_logs else "none")

    # 3. 生成执行命令（用于前端展示）
    actual_command = None
    if task.model_name:
        cmd_parts = ['evalscope']
        cmd_parts.append(f'--model {task.model_name}')
        cmd_parts.append(f'--model-id {task.model_name}')
        cmd_parts.append(f'--eval-type {task.model_type or "openai_api"}')
        if task.model_url:
            cmd_parts.append(f'--api-url "{task.model_url}"')
        if task.model_key:
            # 对 API Key 进行脱敏处理
            masked_key = f"{task.model_key[:4]}...{task.model_key[-4:]}" if len(task.model_key) > 8 else "****"
            cmd_parts.append(f'--api-key "{masked_key}"')
        cmd_parts.append(f'--datasets {" ".join(task.datasets)}')
        if task.limit:
            cmd_parts.append(f'--limit {task.limit}')
        from app.core.config import settings
        cmd_parts.append(f'--work-dir "{os.path.join(settings.EVALSCOPE_WORK_DIR, task.task_uuid)}"')
        cmd_parts.append(f'--eval-backend {task.engine or "Native"}')
        cmd_parts.append(f'--eval-batch-size {task.eval_batch_size}')
        # 判断是否需要沙箱（代码执行类评测）
        need_sandbox = False
        for dataset in task.datasets:
            if dataset in ['mbpp', 'human_eval', 'multiple_mbpp']:
                need_sandbox = True
                break
        if need_sandbox:
            cmd_parts.append('--use-sandbox')
        actual_command = ' \\\n  '.join(cmd_parts)

    return {
        "task_id": task_id,
        "logs": combined_logs,
        "actual_command": actual_command,  # 新增：执行命令
        "status": task.status,
        "current_step": task.current_step,
        "progress": task.progress,
        "log_source": log_source
    }


@router.get("/report/{task_id}")
async def get_evaluation_report_file(
    task_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    直接返回报告 HTML 文件（用于嵌入 iframe）
    """

    result = await db.execute(
        select(EvaluationTask).where(EvaluationTask.id == task_id)
    )
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=404, detail=f"任务 {task_id} 不存在")

    project_root = Path(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

    # 优先使用 output_dir 字段，其次使用 task_uuid
    if task.output_dir:
        work_dir = project_root / task.output_dir.replace('../', '')
    else:
        work_dir = project_root / "outputs" / task.task_uuid

    if not work_dir.exists():
        raise HTTPException(status_code=404, detail=f"输出目录不存在: {work_dir}")

    # 直接查找 work_dir/reports/report.html（不是在子目录中找）
    report_file = work_dir / "reports" / "report.html"

    if not report_file.exists():
        # 如果不存在，尝试查找其他位置的 report.html
        for html_path in work_dir.rglob("report.html"):
            report_file = html_path
            logger.info(f"从备选位置读取报告: {report_file}")
            break

        if not report_file.exists():
            raise HTTPException(status_code=404, detail=f"报告文件不存在: {report_file}")

    logger.info(f"返回报告文件: {report_file}")

    def iterfile():
        with open(report_file, "rb") as f:
            while chunk := f.read(8192):
                yield chunk

    return StreamingResponse(
        iterfile(),
        media_type="text/html",
        headers={"Content-Disposition": "inline"}
    )


@router.get("/stream/{task_id}")
async def stream_task_updates(task_id: int, db: AsyncSession = Depends(get_db)):
    """
    SSE 实时推送任务更新

    推送事件:
    - task_update: 任务状态更新
    - progress: 进度更新
    - logs: 日志更新
    - complete: 任务完成
    """
    queue = await SSEManager.connect(task_id)

    async def event_generator():
        """生成 SSE 事件流"""
        try:
            # 发送初始连接确认
            yield f"event: connected\ndata: {json.dumps({'task_id': task_id, 'message': '已连接'})}\n\n"

            while True:
                try:
                    # 等待消息，超时则发送心跳
                    message = await asyncio.wait_for(queue.get(), timeout=30)
                    # broadcast 已经组装好完整 SSE 帧（含尾部空行），直接透传
                    yield message
                except asyncio.TimeoutError:
                    # 发送心跳
                    yield f"event: heartbeat\ndata: {json.dumps({'task_id': task_id})}\n\n"
                except asyncio.CancelledError:
                    break
        except GeneratorExit:
            pass
        finally:
            await SSEManager.disconnect(task_id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


# 修改进度回调，添加 SSE 广播
def create_progress_callback(task_id: int):
    """创建进度回调函数 - 不持有 db session"""
    def callback(progress: int, message: str):
        """同步回调函数，内部调度异步任务"""
        try:
            # 创建新的事件循环来执行异步操作
            loop = asyncio.get_event_loop()
            # 检查是否已在事件循环中
            if loop.is_running():
                # 如果事件循环正在运行，创建任务
                asyncio.create_task(_update_progress(task_id, progress, message))
            else:
                # 如果没有运行的事件循环，在新循环中运行
                loop.run_until_complete(_update_progress(task_id, progress, message))
        except Exception as e:
            logger.warning(f"更新任务进度失败: {e}")

    return callback


async def _update_progress(task_id: int, progress: int, message: str):
    """异步更新进度 - 创建独立的 db session"""
    from app.db.database import async_session_maker

    async with async_session_maker() as db:
        try:
            result = await db.execute(
                select(EvaluationTask).where(EvaluationTask.id == task_id)
            )
            task = result.scalar_one_or_none()
            if not task:
                return
            # 终态任务忽略后续进度回调，避免 evalscope 内部回调把 progress 从 100 改回 90
            if task.status in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED):
                logger.debug(
                    f"任务 {task_id} 已为终态 {task.status.value}，忽略 progress={progress}/{message!r}"
                )
                return
            task.progress = progress
            task.current_step = message
            await db.commit()

            # 通过 SSE 广播进度更新
            await SSEManager.broadcast(task_id, "progress", {
                "progress": progress,
                "current_step": message,
                "status": task.status.value if hasattr(task.status, 'value') else task.status
            })
        except Exception as e:
            logger.warning(f"更新任务进度失败: {e}")
