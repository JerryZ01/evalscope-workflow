"""
评测工作流状态定义
"""
from typing import TypedDict, Optional, Any, List, Annotated
from langgraph.graph.message import add_messages


class EvalState(TypedDict, total=False):
    """评测工作流状态"""

    # 任务标识
    task_id: int
    task_uuid: str
    task_name: str

    # 模型配置
    model_name: str
    model_type: str
    model_url: Optional[str]
    model_key: Optional[str]
    generation_config: dict

    # 数据集配置
    datasets: List[str]
    dataset_args: dict
    limit: Optional[int]
    eval_batch_size: int
    engine: str

    # 断点续测
    use_cache: Optional[str]
    rerun_review: bool

    # 工作流控制
    retry_count: int
    max_retries: int
    need_sandbox: bool
    sandbox_datasets: List[str]
    need_judge: bool

    # 执行结果
    eval_success: bool
    eval_error: Optional[str]
    eval_score: float
    eval_metrics: list
    eval_duration: float
    output_dir: Optional[str]
    work_dir: str

    # 诊断结果
    diagnosis: Optional[str]
    should_retry: bool

    # 任务配置摘要（供人工确认节点展示）
    config_summary: str

    # 当前步骤（同步到 EvaluationTask.current_step）
    current_step: str
