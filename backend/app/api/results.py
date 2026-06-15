"""
评测结果 API 路由
"""
from typing import Optional, List
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db.models import EvaluationTask, TaskStatus
from app.schemas.result import (
    ReportResponseSchema,
    VisualizationDataSchema,
    TrendResponseSchema,
    TrendDataSchema
)
from evalscope.report import Report

router = APIRouter()


def convert_report_to_schema(report: Report) -> ReportResponseSchema:
    """将 Report 对象转换为响应 Schema"""
    # 转换为兼容格式
    metrics_data = []
    for metric in report.metrics:
        categories_data = []
        for category in metric.categories:
            subsets_data = []
            for subset in category.subsets:
                subsets_data.append({
                    'name': subset.name,
                    'score': subset.score,
                    'num': subset.num
                })
            categories_data.append({
                'name': category.name if isinstance(category.name, str) else ' / '.join(category.name),
                'num': category.num,
                'score': category.score,
                'macro_score': category.macro_score,
                'subsets': subsets_data
            })
        metrics_data.append({
            'name': metric.name,
            'num': metric.num,
            'score': metric.score,
            'macro_score': metric.macro_score,
            'categories': categories_data
        })

    return ReportResponseSchema(
        name=report.name,
        dataset_name=report.dataset_name,
        dataset_pretty_name=report.dataset_pretty_name or "",
        dataset_description=report.dataset_description or "",
        model_name=report.model_name,
        score=report.score,
        metrics=metrics_data,
        analysis=report.analysis or "N/A"
    )


@router.get("/tasks/{task_id}/results", response_model=ReportResponseSchema)
async def get_task_results(
    task_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    获取任务评测结果
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

    if not task.results:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"任务 {task_id} 还没有评测结果"
        )

    # 从结果构建 Report 对象
    try:
        report = Report.from_dict(task.results)
        return convert_report_to_schema(report)
    except Exception as e:
        # 如果无法解析为 Report，直接返回原始数据
        return ReportResponseSchema(
            name=f"report_{task_id}",
            dataset_name=task.datasets[0] if task.datasets else "unknown",
            dataset_pretty_name="",
            dataset_description="",
            model_name=task.model_name,
            score=task.results.get('score', 0.0),
            metrics=[],
            analysis="N/A"
        )


@router.get("/tasks/{task_id}/visualization", response_model=VisualizationDataSchema)
async def get_visualization_data(
    task_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    获取可视化所需数据
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

    if not task.results:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"任务 {task_id} 还没有评测结果"
        )

    try:
        report = Report.from_dict(task.results)

        # 提取概览数据
        overview = {
            'score': report.score,
            'model': report.model_name,
            'dataset': report.dataset_name,
            'dataset_pretty_name': report.dataset_pretty_name,
            'total_samples': report.metrics[0].num if report.metrics else 0,
            'duration': task.duration
        }

        # 提取雷达图数据
        radar = [
            {'metric': m.name, 'score': m.score}
            for m in report.metrics
        ]

        # 提取类别柱状图数据
        categories = []
        if report.metrics:
            for category in report.metrics[0].categories:
                cat_name = category.name if isinstance(category.name, str) else ' / '.join(category.name)
                categories.append({
                    'name': cat_name,
                    'score': category.score,
                    'num': category.num
                })

        # 分析报告
        analysis = report.analysis if report.analysis and report.analysis != "N/A" else None

        return VisualizationDataSchema(
            overview=overview,
            radar=radar,
            categories=categories,
            analysis=analysis
        )

    except Exception as e:
        # 返回简化数据
        return VisualizationDataSchema(
            overview={
                'score': task.results.get('score', 0.0),
                'model': task.model_name,
                'dataset': task.datasets[0] if task.datasets else "unknown",
                'dataset_pretty_name': "",
                'total_samples': 0,
                'duration': task.duration
            },
            radar=[],
            categories=[],
            analysis=None
        )


@router.get("/models/{model_name}/trend", response_model=TrendResponseSchema)
async def get_model_trend(
    model_name: str,
    dataset: str = Query(..., description="数据集名称"),
    db: AsyncSession = Depends(get_db)
):
    """
    获取模型在指定数据集上的历史表现趋势
    """
    result = await db.execute(
        select(EvaluationTask)
        .where(
            EvaluationTask.model_name == model_name,
            EvaluationTask.datasets.contains([dataset]),
            EvaluationTask.status == TaskStatus.COMPLETED
        )
        .order_by(EvaluationTask.completed_at.asc())
    )
    tasks = result.scalars().all()

    runs = []
    for task in tasks:
        score = 0.0
        if task.results and isinstance(task.results, dict):
            score = task.results.get('score', 0.0)

        runs.append(TrendDataSchema(
            run_id=task.id,
            date=task.completed_at.isoformat() if task.completed_at else "",
            score=score
        ))

    return TrendResponseSchema(
        model_name=model_name,
        dataset=dataset,
        runs=runs
    )


@router.get("/compare")
async def compare_models(
    model_names: str = Query(..., description="逗号分隔的模型名称"),
    dataset: str = Query(..., description="数据集名称"),
    db: AsyncSession = Depends(get_db)
):
    """
    对比多个模型的评测结果
    """
    model_list = [m.strip() for m in model_names.split(',')]

    result = await db.execute(
        select(EvaluationTask)
        .where(
            EvaluationTask.model_name.in_(model_list),
            EvaluationTask.datasets.contains([dataset]),
            EvaluationTask.status == TaskStatus.COMPLETED
        )
        .order_by(EvaluationTask.completed_at.desc())
    )
    tasks = result.scalars().all()

    # 按模型分组，取最新结果
    model_results = {}
    for task in tasks:
        if task.model_name not in model_results:
            score = 0.0
            if task.results and isinstance(task.results, dict):
                score = task.results.get('score', 0.0)

            model_results[task.model_name] = {
                'model': task.model_name,
                'score': score,
                'task_id': task.id,
                'completed_at': task.completed_at.isoformat() if task.completed_at else None,
                'datasets': task.datasets
            }

    return {
        'dataset': dataset,
        'models': list(model_results.values())
    }