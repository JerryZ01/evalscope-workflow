"""
AI 助手工具定义与执行函数
"""
import json
import logging
import asyncio
from typing import Dict, List, Any, Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field

from app.db.models import EvaluationTask, TaskStatus, ManagedModel
from evalscope_wrapper.registry import EvalScopeRegistry
from langchain_core.tools import StructuredTool

logger = logging.getLogger(__name__)

# ---- OpenAI Function Calling 工具定义 ----

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "query_tasks",
            "description": "查询评测任务列表。可按状态筛选、按模型名称筛选、按任务名称模糊搜索、限制返回数量。当用户提到任务名称时，应使用 name 参数搜索。返回任务的ID、名称、模型、数据集、状态、进度、创建时间等摘要信息。",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "按任务名称模糊搜索",
                    },
                    "status": {
                        "type": "string",
                        "enum": ["pending", "running", "completed", "failed", "cancelled"],
                        "description": "按任务状态筛选，不传则返回所有状态",
                    },
                    "model_name": {
                        "type": "string",
                        "description": "按模型名称筛选（精确匹配）",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "返回数量上限，默认10，最大20",
                        "default": 10,
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_task_detail",
            "description": "获取单个评测任务的详情，包括完整配置和评测结果。如果任务已完成，会返回评测分数、各指标详情（含类别和子集得分）。支持按ID或按名称查询，优先使用ID。",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "integer",
                        "description": "任务ID",
                    },
                    "task_name": {
                        "type": "string",
                        "description": "任务名称（模糊匹配），当不知道ID时使用",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_models",
            "description": "对比多个模型在指定数据集上的评测结果。返回每个模型的最新分数、完成时间等信息，便于横向比较。",
            "parameters": {
                "type": "object",
                "properties": {
                    "model_names": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "要对比的模型名称列表",
                    },
                    "dataset": {
                        "type": "string",
                        "description": "数据集名称，如 mmlu, gsm8k 等",
                    },
                },
                "required": ["model_names", "dataset"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_datasets",
            "description": "查询平台支持的评测数据集列表。可按关键词搜索、按标签筛选。返回数据集名称、可读名称、标签、指标等信息。",
            "parameters": {
                "type": "object",
                "properties": {
                    "search": {
                        "type": "string",
                        "description": "搜索关键词，匹配名称或描述",
                    },
                    "tag": {
                        "type": "string",
                        "description": "按标签筛选，如 Math, Coding, Chinese 等",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "返回数量上限，默认20，最大50",
                        "default": 20,
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_managed_models",
            "description": "查询平台中已配置的模型列表。返回模型ID、名称、类型、是否默认、是否活跃等信息。",
            "parameters": {
                "type": "object",
                "properties": {
                    "active_only": {
                        "type": "boolean",
                        "description": "是否只返回活跃模型，默认true",
                        "default": True,
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_dashboard_summary",
            "description": "获取平台仪表盘的统计概览，包括各状态任务数量、总模型数、总数据集数等。",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
]


# ---- 工具执行函数 ----


async def query_tasks(params: dict, db: AsyncSession) -> List[dict]:
    limit = min(params.get("limit", 10), 20)
    query = select(EvaluationTask).order_by(EvaluationTask.created_at.desc())
    if params.get("name"):
        query = query.where(EvaluationTask.name.contains(params["name"]))
    if params.get("status"):
        try:
            query = query.where(EvaluationTask.status == TaskStatus(params["status"]))
        except ValueError:
            pass
    if params.get("model_name"):
        query = query.where(EvaluationTask.model_name == params["model_name"])
    query = query.limit(limit)
    result = await db.execute(query)
    tasks = result.scalars().all()
    return [
        {
            "id": t.id,
            "name": t.name,
            "model_name": t.model_name,
            "datasets": t.datasets,
            "status": t.status.value,
            "progress": t.progress,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "completed_at": t.completed_at.isoformat() if t.completed_at else None,
            "duration": t.duration,
        }
        for t in tasks
    ]


async def get_task_detail(params: dict, db: AsyncSession) -> dict:
    task_id = params.get("task_id")
    task_name = params.get("task_name")

    if task_id is None and not task_name:
        return {"error": "请提供 task_id 或 task_name 参数"}

    task = None
    if task_id is not None:
        result = await db.execute(
            select(EvaluationTask).where(EvaluationTask.id == task_id)
        )
        task = result.scalar_one_or_none()
    if task is None and task_name:
        result = await db.execute(
            select(EvaluationTask).where(EvaluationTask.name.contains(task_name))
            .order_by(EvaluationTask.created_at.desc())
            .limit(1)
        )
        task = result.scalar_one_or_none()

    if not task:
        return {"error": f"未找到任务（task_id={task_id}, task_name={task_name}），建议先调用 query_tasks 按名称搜索获取任务ID"}

    detail = {
        "id": task.id,
        "name": task.name,
        "description": task.description,
        "model_name": task.model_name,
        "datasets": task.datasets,
        "dataset_args": task.dataset_args,
        "generation_config": task.generation_config,
        "engine": task.engine,
        "status": task.status.value,
        "progress": task.progress,
        "current_step": task.current_step,
        "limit": task.limit,
        "eval_batch_size": task.eval_batch_size,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "started_at": task.started_at.isoformat() if task.started_at else None,
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "duration": task.duration,
        "need_sandbox": task.datasets
        and any(
            d.lower() in EvalScopeRegistry.SANDBOX_REQUIRED_DATASETS
            for d in task.datasets
        ),
    }

    # 评测结果
    if task.results and isinstance(task.results, dict):
        detail["results"] = {
            "score": task.results.get("score", 0.0),
            "metrics": task.results.get("metrics", []),
        }

    if task.error:
        detail["error"] = task.error

    return detail


async def compare_models(params: dict, db: AsyncSession) -> dict:
    model_names = params.get("model_names", [])
    dataset = params.get("dataset", "")
    if not model_names or not dataset:
        return {"error": "需要提供 model_names 和 dataset 参数"}

    result = await db.execute(
        select(EvaluationTask)
        .where(
            EvaluationTask.model_name.in_(model_names),
            EvaluationTask.datasets.contains([dataset]),
            EvaluationTask.status == TaskStatus.COMPLETED,
        )
        .order_by(EvaluationTask.completed_at.desc())
    )
    tasks = result.scalars().all()

    model_results = {}
    for task in tasks:
        if task.model_name not in model_results:
            score = 0.0
            if task.results and isinstance(task.results, dict):
                score = task.results.get("score", 0.0)
            model_results[task.model_name] = {
                "model": task.model_name,
                "score": score,
                "task_id": task.id,
                "completed_at": (
                    task.completed_at.isoformat() if task.completed_at else None
                ),
                "datasets": task.datasets,
            }

    return {"dataset": dataset, "models": list(model_results.values())}


async def list_datasets(params: dict, db: AsyncSession) -> List[dict]:
    search = params.get("search", "").lower()
    tag = params.get("tag")
    limit = min(params.get("limit", 20), 50)

    datasets = EvalScopeRegistry.get_all_datasets()

    if search:
        datasets = [
            d
            for d in datasets
            if search in d["name"].lower()
            or (d.get("pretty_name") and search in d["pretty_name"].lower())
            or (d.get("description_zh") and search in d["description_zh"].lower())
            or (d.get("description") and search in d["description"].lower())
        ]

    if tag:
        datasets = [d for d in datasets if tag in d.get("tags", [])]

    datasets = datasets[:limit]
    return [
        {
            "name": d["name"],
            "pretty_name": d.get("pretty_name", ""),
            "tags": d.get("tags", []),
            "few_shot_num": d.get("few_shot_num", 0),
            "metric_list": d.get("metric_list", []),
            "subset_count": len(d.get("subset_list", [])),
            "need_sandbox": d.get("need_sandbox", False),
            "need_judge": d.get("need_judge", False),
        }
        for d in datasets
    ]


async def list_managed_models(params: dict, db: AsyncSession) -> List[dict]:
    active_only = params.get("active_only", True)
    query = select(ManagedModel).order_by(ManagedModel.created_at.desc())
    if active_only:
        query = query.where(ManagedModel.is_active == True)
    result = await db.execute(query)
    models = result.scalars().all()
    return [
        {
            "id": m.id,
            "name": m.name,
            "model_type": m.model_type,
            "model_name": m.model_name,
            "is_default": m.is_default,
            "is_active": m.is_active,
            "description": m.description,
        }
        for m in models
    ]


async def get_dashboard_summary(params: dict, db: AsyncSession) -> dict:
    # 按状态统计任务数
    status_counts = {}
    for status in TaskStatus:
        result = await db.execute(
            select(func.count(EvaluationTask.id)).where(
                EvaluationTask.status == status
            )
        )
        status_counts[status.value] = result.scalar() or 0

    # 模型数
    result = await db.execute(
        select(func.count(ManagedModel.id)).where(ManagedModel.is_active == True)
    )
    model_count = result.scalar() or 0

    # 数据集数
    dataset_count = len(EvalScopeRegistry.get_all_datasets())

    return {
        "task_counts": status_counts,
        "total_tasks": sum(status_counts.values()),
        "active_model_count": model_count,
        "dataset_count": dataset_count,
    }


# ---- 工具分发 ----

_TOOL_HANDLERS = {
    "query_tasks": query_tasks,
    "get_task_detail": get_task_detail,
    "compare_models": compare_models,
    "list_datasets": list_datasets,
    "list_managed_models": list_managed_models,
    "get_dashboard_summary": get_dashboard_summary,
}


async def execute_tool(name: str, arguments: dict, db: AsyncSession) -> str:
    """执行工具并返回 JSON 字符串结果"""
    handler = _TOOL_HANDLERS.get(name)
    if not handler:
        return json.dumps({"error": f"未知工具: {name}"}, ensure_ascii=False)
    try:
        result = await handler(arguments, db)
        return json.dumps(result, ensure_ascii=False, default=str)
    except Exception as e:
        logger.error(f"工具 {name} 执行失败: {e}", exc_info=True)
        return json.dumps({"error": f"工具执行失败: {str(e)}"}, ensure_ascii=False)


async def execute_tools_parallel(
    tool_calls: list, db: AsyncSession
) -> List[dict]:
    """并行执行多个工具调用，返回 tool result 消息列表"""
    tasks = []
    for tc in tool_calls:
        fn_name = tc["function"]["name"]
        try:
            fn_args = json.loads(tc["function"]["arguments"])
        except json.JSONDecodeError:
            fn_args = {}
        tasks.append(execute_tool(fn_name, fn_args, db))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    tool_results = []
    for tc, result in zip(tool_calls, results):
        content = result if isinstance(result, str) else json.dumps(
            {"error": str(result)}, ensure_ascii=False
        )
        tool_results.append(
            {
                "tool_call_id": tc["id"],
                "role": "tool",
                "name": tc["function"]["name"],
                "content": content,
            }
        )
    return tool_results


# ---- LangChain Tool 包装 ----


class QueryTasksArgs(BaseModel):
    name: Optional[str] = Field(None, description="按任务名称模糊搜索")
    status: Optional[str] = Field(
        None,
        description="按任务状态筛选，可选值: pending, running, completed, failed, cancelled",
    )
    model_name: Optional[str] = Field(None, description="按模型名称精确匹配")
    limit: int = Field(10, description="返回数量上限，默认10，最大20")


class GetTaskDetailArgs(BaseModel):
    task_id: Optional[int] = Field(None, description="任务ID")
    task_name: Optional[str] = Field(None, description="任务名称（模糊匹配）")


class CompareModelsArgs(BaseModel):
    model_names: List[str] = Field(..., description="要对比的模型名称列表")
    dataset: str = Field(..., description="数据集名称，如 mmlu, gsm8k 等")


class ListDatasetsArgs(BaseModel):
    search: Optional[str] = Field(None, description="搜索关键词，匹配名称或描述")
    tag: Optional[str] = Field(None, description="按标签筛选，如 Math, Coding, Chinese 等")
    limit: int = Field(20, description="返回数量上限，默认20，最大50")


class ListManagedModelsArgs(BaseModel):
    active_only: bool = Field(True, description="是否只返回活跃模型，默认true")


class GetDashboardSummaryArgs(BaseModel):
    pass


def _build_langchain_tools(db: AsyncSession) -> List[StructuredTool]:
    """把现有 6 个 async 工具包装成 LangChain StructuredTool，闭包绑定 db。"""

    async def _query_tasks(name: Optional[str] = None,
                           status: Optional[str] = None,
                           model_name: Optional[str] = None,
                           limit: int = 10) -> str:
        result = await query_tasks(
            {"name": name, "status": status, "model_name": model_name, "limit": limit},
            db,
        )
        return json.dumps(result, ensure_ascii=False, default=str)

    async def _get_task_detail(task_id: Optional[int] = None,
                               task_name: Optional[str] = None) -> str:
        result = await get_task_detail(
            {"task_id": task_id, "task_name": task_name}, db
        )
        return json.dumps(result, ensure_ascii=False, default=str)

    async def _compare_models(model_names: List[str], dataset: str) -> str:
        result = await compare_models(
            {"model_names": model_names, "dataset": dataset}, db
        )
        return json.dumps(result, ensure_ascii=False, default=str)

    async def _list_datasets(search: Optional[str] = None,
                             tag: Optional[str] = None,
                             limit: int = 20) -> str:
        result = await list_datasets(
            {"search": search, "tag": tag, "limit": limit}, db
        )
        return json.dumps(result, ensure_ascii=False, default=str)

    async def _list_managed_models(active_only: bool = True) -> str:
        result = await list_managed_models({"active_only": active_only}, db)
        return json.dumps(result, ensure_ascii=False, default=str)

    async def _get_dashboard_summary() -> str:
        result = await get_dashboard_summary({}, db)
        return json.dumps(result, ensure_ascii=False, default=str)

    query_tasks_tool = StructuredTool.from_function(
        coroutine=_query_tasks,
        name="query_tasks",
        description=(
            "查询评测任务列表。可按状态筛选、按模型名称筛选、按任务名称模糊搜索、限制返回数量。"
            "当用户提到任务名称时，应使用 name 参数搜索。"
            "返回任务的ID、名称、模型、数据集、状态、进度、创建时间等摘要信息。"
        ),
        args_schema=QueryTasksArgs,
    )

    get_task_detail_tool = StructuredTool.from_function(
        coroutine=_get_task_detail,
        name="get_task_detail",
        description=(
            "获取单个评测任务的详情，包括完整配置和评测结果。"
            "如果任务已完成，会返回评测分数、各指标详情。支持按ID或按名称查询，优先使用ID。"
        ),
        args_schema=GetTaskDetailArgs,
    )

    compare_models_tool = StructuredTool.from_function(
        coroutine=_compare_models,
        name="compare_models",
        description=(
            "对比多个模型在指定数据集上的评测结果。"
            "返回每个模型的最新分数、完成时间等信息，便于横向比较。"
        ),
        args_schema=CompareModelsArgs,
    )

    list_datasets_tool = StructuredTool.from_function(
        coroutine=_list_datasets,
        name="list_datasets",
        description=(
            "查询平台支持的评测数据集列表。可按关键词搜索、按标签筛选。"
            "返回数据集名称、可读名称、标签、指标等信息。"
        ),
        args_schema=ListDatasetsArgs,
    )

    list_managed_models_tool = StructuredTool.from_function(
        coroutine=_list_managed_models,
        name="list_managed_models",
        description="查询平台中已配置的模型列表。返回模型ID、名称、类型、是否默认、是否活跃等信息。",
        args_schema=ListManagedModelsArgs,
    )

    get_dashboard_summary_tool = StructuredTool.from_function(
        coroutine=_get_dashboard_summary,
        name="get_dashboard_summary",
        description="获取平台仪表盘的统计概览，包括各状态任务数量、总模型数、总数据集数等。",
        args_schema=GetDashboardSummaryArgs,
    )

    return [
        query_tasks_tool,
        get_task_detail_tool,
        compare_models_tool,
        list_datasets_tool,
        list_managed_models_tool,
        get_dashboard_summary_tool,
    ]
