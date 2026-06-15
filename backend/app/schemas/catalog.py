"""
目录相关 Schema 定义
"""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class DatasetSchema(BaseModel):
    """数据集 Schema"""
    name: str
    pretty_name: Optional[str] = None
    description: Optional[str] = None
    description_zh: Optional[str] = None  # 中文 Markdown 描述
    tags: List[str] = Field(default_factory=list)
    subset_list: List[str] = Field(default_factory=list)
    few_shot_num: int = 0
    metric_list: List[Any] = Field(default_factory=list)  # Can be str or dict
    output_types: List[str] = Field(default_factory=list)
    need_sandbox: bool = False  # 是否需要沙箱执行（编程类数据集）
    need_judge: bool = False  # 是否需要 LLM 评判器（复杂答案类数据集）


class DatasetListResponse(BaseModel):
    """数据集列表响应"""
    total: int
    datasets: List[DatasetSchema]


class ModelTypeSchema(BaseModel):
    """模型类型 Schema"""
    name: str
    description: Optional[str] = None
    config_schema: Dict[str, Any] = Field(default_factory=dict)


class ModelTypeListResponse(BaseModel):
    """模型类型列表响应"""
    total: int
    models: List[ModelTypeSchema]


class MetricSchema(BaseModel):
    """指标 Schema"""
    name: str
    description: Optional[str] = None
    category: Optional[str] = None


class MetricListResponse(BaseModel):
    """指标列表响应"""
    total: int
    metrics: List[MetricSchema]


class EngineSchema(BaseModel):
    """评测引擎 Schema"""
    name: str
    description: str
    supported_types: List[str] = Field(default_factory=list)


class EngineListResponse(BaseModel):
    """评测引擎列表响应"""
    total: int
    engines: List[EngineSchema]