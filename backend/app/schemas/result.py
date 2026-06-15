"""
评测结果相关 Schema 定义
"""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class SubsetSchema(BaseModel):
    """子集 Schema"""
    name: str
    score: float
    num: int


class CategorySchema(BaseModel):
    """类别 Schema"""
    name: str
    num: int
    score: float
    macro_score: float
    subsets: List[SubsetSchema] = Field(default_factory=list)


class MetricResultSchema(BaseModel):
    """指标结果 Schema"""
    name: str
    num: int
    score: float
    macro_score: float
    categories: List[CategorySchema] = Field(default_factory=list)


class ReportOverviewSchema(BaseModel):
    """报告概览 Schema"""
    score: float
    model: str
    dataset: str
    dataset_pretty_name: Optional[str]
    total_samples: int
    duration: Optional[float] = None


class RadarDataSchema(BaseModel):
    """雷达图数据"""
    metric: str
    score: float


class CategoryBarDataSchema(BaseModel):
    """类别柱状图数据"""
    name: str
    score: float
    num: int


class VisualizationDataSchema(BaseModel):
    """可视化数据"""
    overview: ReportOverviewSchema
    radar: List[RadarDataSchema]
    categories: List[CategoryBarDataSchema]
    analysis: Optional[str] = None


class ReportResponseSchema(BaseModel):
    """报告响应"""
    name: str
    dataset_name: str
    dataset_pretty_name: Optional[str]
    dataset_description: Optional[str]
    model_name: str
    score: float
    metrics: List[MetricResultSchema]
    analysis: str = "N/A"


class TrendDataSchema(BaseModel):
    """趋势数据"""
    run_id: int
    date: str
    score: float


class TrendResponseSchema(BaseModel):
    """趋势响应"""
    model_name: str
    dataset: str
    runs: List[TrendDataSchema]