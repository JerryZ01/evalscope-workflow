"""
目录信息 API 路由
"""
from typing import List, Optional
from fastapi import APIRouter, HTTPException, status, Query

from app.schemas.catalog import (
    DatasetSchema,
    DatasetListResponse,
    ModelTypeSchema,
    ModelTypeListResponse,
    MetricSchema,
    MetricListResponse,
    EngineSchema,
    EngineListResponse
)
from evalscope_wrapper.registry import EvalScopeRegistry

router = APIRouter()


@router.get("/datasets", response_model=DatasetListResponse)
async def list_datasets(
    search: Optional[str] = Query(None, description="搜索数据集名称"),
    tag: Optional[str] = Query(None, description="按标签筛选"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200)
):
    """
    获取数据集列表

    - **search**: 搜索名称或描述
    - **tag**: 按标签筛选
    - **skip**: 分页偏移
    - **limit**: 每页数量
    """
    datasets = EvalScopeRegistry.get_all_datasets()

    # 搜索过滤
    if search:
        search_lower = search.lower()
        datasets = [
            d for d in datasets
            if search_lower in d['name'].lower() or
               (d.get('pretty_name') and search_lower in d['pretty_name'].lower()) or
               (d.get('description') and search_lower in d['description'].lower())
        ]

    # 标签过滤
    if tag:
        datasets = [
            d for d in datasets
            if tag in d.get('tags', [])
        ]

    total = len(datasets)
    datasets = datasets[skip:skip + limit]

    return DatasetListResponse(
        total=total,
        datasets=[DatasetSchema(**d) for d in datasets]
    )


@router.get("/datasets/{name}", response_model=DatasetSchema)
async def get_dataset(name: str):
    """
    获取指定数据集详情
    """
    dataset = EvalScopeRegistry.get_dataset_by_name(name)

    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"数据集 {name} 不存在"
        )

    return DatasetSchema(**dataset)


@router.get("/models", response_model=ModelTypeListResponse)
async def list_models():
    """
    获取支持的模型类型列表
    """
    models = EvalScopeRegistry.get_all_model_types()

    return ModelTypeListResponse(
        total=len(models),
        models=[ModelTypeSchema(**m) for m in models]
    )


@router.get("/models/{name}", response_model=ModelTypeSchema)
async def get_model(name: str):
    """
    获取指定模型类型详情
    """
    models = EvalScopeRegistry.get_all_model_types()
    model = next((m for m in models if m['name'] == name), None)

    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"模型类型 {name} 不存在"
        )

    return ModelTypeSchema(**model)


@router.get("/metrics", response_model=MetricListResponse)
async def list_metrics(
    category: Optional[str] = Query(None, description="按类别筛选")
):
    """
    获取指标列表

    - **category**: 筛选类别 (text, multimodal, code, math)
    """
    metrics = EvalScopeRegistry.get_all_metrics()

    # 简单分类（基于指标名称关键词）
    if category:
        category_keywords = {
            'text': ['acc', 'exact', 'f1', 'bertscore', 'rouge'],
            'multimodal': ['vqa', 'clip', 'pick', 'blipv2'],
            'code': ['pass', 'code', 'mbpp', 'humaneval'],
            'math': ['math', 'acc', 'anls']
        }

        keywords = category_keywords.get(category.lower(), [])
        if keywords:
            metrics = [
                m for m in metrics
                if any(k in m['name'].lower() for k in keywords)
            ]

    return MetricListResponse(
        total=len(metrics),
        metrics=[MetricSchema(**m) for m in metrics]
    )


@router.get("/engines", response_model=EngineListResponse)
async def list_engines():
    """
    获取支持的评测引擎列表
    """
    engines = EvalScopeRegistry.get_all_engines()

    return EngineListResponse(
        total=len(engines),
        engines=[EngineSchema(**e) for e in engines]
    )


@router.get("/engines/{name}", response_model=EngineSchema)
async def get_engine(name: str):
    """
    获取指定评测引擎详情
    """
    engines = EvalScopeRegistry.get_all_engines()
    engine = next((e for e in engines if e['name'] == name), None)

    if not engine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"评测引擎 {name} 不存在"
        )

    return EngineSchema(**engine)