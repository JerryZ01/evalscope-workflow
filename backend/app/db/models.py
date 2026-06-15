"""
数据库模型定义
"""
from datetime import datetime
from typing import Optional, List
from sqlalchemy import Column, Integer, String, JSON, DateTime, Enum, Text, ForeignKey, Float, Boolean
from sqlalchemy.orm import relationship
import uuid

from app.db.database import Base
import enum


class TaskStatus(str, enum.Enum):
    """任务状态枚举"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class User(Base):
    """用户表"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=True)
    role = Column(String(20), default="user")  # admin, user
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 关系
    tasks = relationship("EvaluationTask", back_populates="user")


class EvaluationTask(Base):
    """评测任务表"""
    __tablename__ = "evaluation_tasks"

    id = Column(Integer, primary_key=True, index=True)
    task_uuid = Column(String(36), unique=True, nullable=False, index=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False, index=True)
    description = Column(String(1000), nullable=True)

    # 模型配置
    model_name = Column(String(255), nullable=False)
    model_type = Column(String(50), default="openai_api")  # openai_api, llm_ckpt, text2image
    model_url = Column(String(500), nullable=True)
    model_key = Column(String(255), nullable=True)
    generation_config = Column(JSON, default=dict)  # temperature, max_tokens 等

    # 数据集配置
    datasets = Column(JSON, nullable=False)  # ["mmlu", "gsm8k"]
    dataset_args = Column(JSON, default=dict)
    limit = Column(Integer, nullable=True)  # 评测样本数限制
    eval_batch_size = Column(Integer, default=3)

    # 评测引擎
    engine = Column(String(50), default="native")  # native, opencompass, vlmeval, rag_eval

    # 断点续测
    use_cache = Column(String(500), nullable=True)  # 续测时指定之前的工作目录
    rerun_review = Column(Boolean, default=False)  # 是否重新执行 review

    # 任务状态
    status = Column(Enum(TaskStatus), default=TaskStatus.PENDING, index=True)
    progress = Column(Integer, default=0)  # 0-100
    current_step = Column(String(100), nullable=True)

    # 结果
    results = Column(JSON, nullable=True)  # 评测结果
    output_dir = Column(String(500), nullable=True)  # 实际输出目录路径
    report_path = Column(String(500), nullable=True)
    logs = Column(Text, nullable=True)
    error = Column(Text, nullable=True)  # 错误信息

    # 元数据
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    duration = Column(Float, nullable=True)  # 耗时(秒)

    # 外键
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user = relationship("User", back_populates="tasks")


class Dataset(Base):
    """数据集缓存表"""
    __tablename__ = "datasets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False, index=True)
    pretty_name = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    tags = Column(JSON, default=list)
    subset_list = Column(JSON, default=list)
    few_shot_num = Column(Integer, default=0)
    metric_list = Column(JSON, default=list)
    output_types = Column(JSON, default=list)
    meta = Column(JSON, default=dict)  # 原始 BenchmarkMeta

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ModelType(Base):
    """模型类型缓存表"""
    __tablename__ = "model_types"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False, index=True)
    description = Column(Text, nullable=True)
    config_schema = Column(JSON, default=dict)  # 配置参数 schema
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Metric(Base):
    """指标缓存表"""
    __tablename__ = "metrics"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False, index=True)
    description = Column(Text, nullable=True)
    category = Column(String(50), nullable=True)  # text, multimodal, code, math
    created_at = Column(DateTime, default=datetime.utcnow)


class ManagedModel(Base):
    """用户管理的模型"""
    __tablename__ = "managed_models"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)  # 显示名称
    model_type = Column(String(50), nullable=False)  # 模型类型
    model_name = Column(String(255), nullable=False)  # 模型标识

    # API 配置
    api_url = Column(String(500), nullable=True)
    api_key = Column(String(255), nullable=True)

    # 默认参数
    generation_config = Column(JSON, default=dict)
    is_default = Column(Boolean, default=False)

    # 元数据
    description = Column(String(500))
    is_active = Column(Boolean, default=True)
    use_count = Column(Integer, default=0)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)