"""
模型管理 Schema 定义
"""
from typing import Optional, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field


# ========== 请求 Schema ==========

class ManagedModelCreate(BaseModel):
    """创建模型请求"""
    name: str = Field(..., min_length=1, max_length=100)
    model_type: str = Field(..., min_length=1)
    model_name: str = Field(..., min_length=1, max_length=255)
    api_url: Optional[str] = Field(None, max_length=500)
    api_key: Optional[str] = Field(None, max_length=255)
    generation_config: Dict[str, Any] = Field(default_factory=dict)
    description: Optional[str] = Field(None, max_length=500)
    is_default: bool = False


class ManagedModelUpdate(BaseModel):
    """更新模型请求"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    model_type: Optional[str] = Field(None, min_length=1)
    model_name: Optional[str] = Field(None, min_length=1, max_length=255)
    api_url: Optional[str] = Field(None, max_length=500)
    api_key: Optional[str] = Field(None, max_length=255)
    generation_config: Optional[Dict[str, Any]] = None
    description: Optional[str] = Field(None, max_length=500)
    is_active: Optional[bool] = None
    is_default: Optional[bool] = None


# ========== 响应 Schema ==========

class ManagedModelResponse(BaseModel):
    """模型响应"""
    id: int
    name: str
    model_type: str
    model_name: str
    api_url: Optional[str]
    api_key: Optional[str]  # 实际返回时应该隐藏或加密
    generation_config: Dict[str, Any]
    is_default: bool
    description: Optional[str]
    is_active: bool
    use_count: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ManagedModelListResponse(BaseModel):
    """模型列表响应"""
    total: int
    models: list[ManagedModelResponse]


class ManagedModelBriefResponse(BaseModel):
    """简要模型信息（用于下拉选择）"""
    id: int
    name: str
    model_type: str
    model_name: str
    api_url: Optional[str]
    is_default: bool

    class Config:
        from_attributes = True