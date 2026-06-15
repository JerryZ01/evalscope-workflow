"""
Pydantic Schemas for API
"""
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class TaskStatus(str, Enum):
    PENDING = 'pending'
    RUNNING = 'running'
    COMPLETED = 'completed'
    FAILED = 'failed'
    CANCELLED = 'cancelled'
    PAUSED = 'paused'


class EvalType(str, Enum):
    LLM_CKPT = 'llm_ckpt'
    OPENAI_API = 'openai_api'
    ANTHROPIC_API = 'anthropic_api'
    MOCK_LLM = 'mock_llm'
    TEXT2IMAGE = 'text2image'
    IMAGE_EDITING = 'image_editing'


class TaskCreate(BaseModel):
    name: str = Field(..., description='Task name')
    description: Optional[str] = Field(None, description='Task description')
    model: str = Field(..., description='Model name or path')
    eval_type: EvalType = Field(EvalType.OPENAI_API, description='Evaluation type')
    eval_backend: str = Field('Native', description='Evaluation backend')
    api_url: Optional[str] = Field(None, description='API URL for service evaluation')
    api_key: Optional[str] = Field(None, description='API key')
    generation_config: Dict[str, Any] = Field(default_factory=dict, description='Generation config')
    datasets: List[str] = Field(default_factory=list, description='List of dataset names')
    dataset_args: Dict[str, Any] = Field(default_factory=dict, description='Dataset-specific args')
    limit: Optional[int] = Field(None, description='Limit number of samples')
    work_dir: Optional[str] = Field(None, description='Custom output path')


class TaskUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    model: Optional[str] = None
    eval_type: Optional[EvalType] = None
    eval_backend: Optional[str] = None
    api_url: Optional[str] = None
    api_key: Optional[str] = None
    generation_config: Optional[Dict[str, Any]] = None
    datasets: Optional[List[str]] = None
    dataset_args: Optional[Dict[str, Any]] = None
    limit: Optional[int] = None
    work_dir: Optional[str] = None
    status: Optional[TaskStatus] = None


class TaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: Optional[str]
    model: str
    eval_type: str
    eval_backend: str
    api_url: Optional[str]
    api_key: Optional[str]
    generation_config: Dict[str, Any]
    datasets: List[str]
    dataset_args: Dict[str, Any]
    task_config: Dict[str, Any] = Field(default_factory=dict)
    status: str
    progress: float
    current_step: Optional[str]
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    result_summary: Optional[Dict[str, Any]]
    error_message: Optional[str]
    output_dir: Optional[str]


class TaskListResponse(BaseModel):
    total: int
    items: List[TaskResponse]


class TaskLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: int
    level: str
    message: str
    timestamp: datetime


class TaskResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: int
    dataset_name: str
    metrics: Dict[str, Any]
    details: Dict[str, Any]
    created_at: datetime


class TaskStreamPayload(BaseModel):
    task: TaskResponse
    logs: List[TaskLogResponse]
    results: List[TaskResultResponse]


class AnalysisSampleScore(BaseModel):
    acc: Optional[float] = None
    extracted_prediction: Optional[str] = None
    prediction: Optional[str] = None
    explanation: Optional[str] = None


class AnalysisSample(BaseModel):
    index: int
    target: Optional[str] = None
    prediction_preview: Optional[str] = None
    extracted_prediction: Optional[str] = None
    acc: Optional[float] = None
    status: str
    question_preview: Optional[str] = None


class TaskAnalysisResponse(BaseModel):
    task_id: int
    task_name: str
    status: str
    datasets: List[str]
    sample_count: int
    correct_count: int
    accuracy: float
    issue_count: int
    issue_rate: float
    top_issue: Optional[str] = None
    score_distribution: Dict[str, int]
    dataset_breakdown: List[Dict[str, Any]]
    samples: List[AnalysisSample]


class DatasetInfo(BaseModel):
    name: str
    pretty_name: str
    description: str
    tags: List[str]
    category: str
    few_shot_num: int
    subset_list: List[str]


class ModelTypeInfo(BaseModel):
    name: str
    display_name: str
    description: str
    params: List[str]


class EngineInfo(BaseModel):
    name: str
    display_name: str
    description: str


class CatalogDatasetsResponse(BaseModel):
    total: int
    tags: List[str]
    datasets: List[DatasetInfo]


class CatalogModelsResponse(BaseModel):
    total: int
    models: List[ModelTypeInfo]


class CatalogEnginesResponse(BaseModel):
    total: int
    engines: List[EngineInfo]


class CatalogMetricsResponse(BaseModel):
    total: int
    metrics: List[str]


class DashboardSummaryResponse(BaseModel):
    total_tasks: int
    running_tasks: int
    completed_tasks: int
    failed_tasks: int
    pending_tasks: int
    cancelled_tasks: int
    total_datasets: int
    total_models: int
    total_engines: int
    recent_tasks: List[TaskResponse]


class MessageResponse(BaseModel):
    message: str
    success: bool = True
