"""
任务相关 Schema 定义
"""
from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field

from app.db.models import TaskStatus


# ========== 请求 Schema ==========

class GenerationConfigSchema(BaseModel):
    """生成配置"""
    temperature: float = Field(default=0.7, ge=0, le=2)
    max_tokens: int = Field(default=1024, ge=1, le=32768)
    top_p: float = Field(default=1.0, ge=0, le=1)
    top_k: int = Field(default=50, ge=0)
    stop: Optional[List[str]] = None


class TaskCreateSchema(BaseModel):
    """创建任务请求"""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=1000)

    # 模型配置
    model_name: str = Field(..., min_length=1)
    model_type: str = Field(default="openai_api")
    model_url: Optional[str] = None
    model_key: Optional[str] = None
    generation_config: Dict[str, Any] = Field(default_factory=dict)

    # 数据集配置
    datasets: List[str] = Field(..., min_items=1)
    dataset_args: Dict[str, Any] = Field(default_factory=dict)
    limit: Optional[int] = Field(None, ge=1)
    eval_batch_size: int = Field(default=3, ge=1, le=10)

    # 评测引擎
    engine: str = Field(default="native", description="评测引擎: native, opencompass, vlmeval, rag_eval")

    # 断点续测
    use_cache: Optional[str] = Field(None, description="断点续测：指定之前的工作目录")
    rerun_review: bool = Field(default=False, description="是否重新执行 review")


class TaskUpdateSchema(BaseModel):
    """更新任务请求"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=1000)

    # 模型配置
    model_name: Optional[str] = Field(None, min_length=1)
    model_type: Optional[str] = None
    model_url: Optional[str] = None
    model_key: Optional[str] = None

    # 生成配置
    generation_config: Optional[Dict[str, Any]] = None

    # 数据集配置
    datasets: Optional[List[str]] = Field(None, min_items=1)
    dataset_args: Optional[Dict[str, Any]] = None
    limit: Optional[int] = Field(None, ge=1)
    eval_batch_size: Optional[int] = Field(None, ge=1)

    # 评测引擎
    engine: Optional[str] = None


# ========== 响应 Schema ==========

class TaskStatusSchema(BaseModel):
    """任务状态响应"""
    id: int
    status: TaskStatus
    progress: int
    current_step: Optional[str] = None


class TaskListItemSchema(BaseModel):
    """任务列表项"""
    id: int
    task_uuid: str
    name: str
    description: Optional[str]
    model_name: str
    model_type: str
    datasets: List[str]
    status: TaskStatus
    progress: int
    created_at: datetime
    updated_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]

    class Config:
        from_attributes = True


class TaskDetailSchema(TaskListItemSchema):
    """任务详情"""
    model_url: Optional[str]
    model_key: Optional[str]
    generation_config: Dict[str, Any]
    dataset_args: Dict[str, Any]
    limit: Optional[int]
    eval_batch_size: int
    engine: str = "native"
    use_cache: Optional[str] = None
    rerun_review: bool = False
    results: Optional[Dict[str, Any]]
    report_path: Optional[str]
    logs: Optional[str]
    duration: Optional[float]


class TaskCreateResponseSchema(BaseModel):
    """创建任务响应"""
    id: int
    task_uuid: str
    name: str
    status: TaskStatus
    message: str = "任务创建成功"


# ========== 操作响应 ==========

class TaskActionResponse(BaseModel):
    """任务操作响应"""
    id: int
    status: TaskStatus
    message: str


class TaskDeleteResponse(BaseModel):
    """删除任务响应"""
    id: int
    message: str