"""
AI 助手聊天接口 - LangGraph ReAct Agent + Langfuse 可观测性
"""
import json
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db.models import ManagedModel
from app.api.chat_tools import _build_langchain_tools
from app.core.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)

# Langfuse 状态（仅用于 /langfuse-status 端点显示是否配置）
_langfuse_enabled = bool(
    settings.LANGFUSE_PUBLIC_KEY and settings.LANGFUSE_SECRET_KEY
)
_langfuse_host = settings.LANGFUSE_HOST or None

if _langfuse_enabled:
    logger.info(f"Langfuse 已配置，host={_langfuse_host or 'default'}")
else:
    logger.info("Langfuse 未配置（缺少 LANGFUSE_PUBLIC_KEY 或 LANGFUSE_SECRET_KEY）")

SYSTEM_PROMPT = """你是 EvalScope Workflow 平台的 AI 助手，帮助用户解答使用问题。

EvalScope Workflow 是一个模型评测自动化平台，主要功能包括：

1. **仪表盘** - 查看评测任务概览、统计数据、最近任务状态
2. **任务管理** - 创建、编辑、启动、暂停、恢复、重试和删除评测任务
3. **创建任务** - 配置模型（OpenAI API / Anthropic API / 本地模型）、选择数据集（MMLU、GSM8K、HumanEval、C-Eval 等）、设置参数（temperature、max_tokens、top_p）
4. **Benchmark 库** - 浏览和搜索可用的评测数据集、模型类型、指标
5. **模型管理** - 添加和管理 API 模型配置，测试模型连接，设置默认模型
6. **系统设置** - 配置输出目录、数据集目录、缓存策略等
7. **评测执行** - 支持多种评测引擎（Native、OpenCompass、VLMEval、RAGEval）
8. **结果查看** - 查看评测报告、可视化图表（雷达图、柱状图）、AI 分析

常见问题：
- 评测任务创建后需要在任务列表中点击"启动"才会执行
- 模型需要先在"模型管理"中添加 API 配置才能使用
- 评测日志在任务详情页实时展示，支持 SSE 流式更新
- 支持 BFCL v4（函数调用）、MMLU、GSM8K 等多种 benchmark
- 可以通过"断点续测"功能恢复之前中断的评测

你可以使用以下工具来查询平台的实际数据，请在用户询问涉及具体数据时主动调用：

- **query_tasks**: 查询评测任务列表（可按任务名称搜索、按状态/模型筛选）
- **get_task_detail**: 获取任务的详细配置和评测结果（支持按ID或名称查询）
- **compare_models**: 对比多个模型在指定数据集上的表现
- **list_datasets**: 查询平台支持的评测数据集
- **list_managed_models**: 查询已配置的模型列表
- **get_dashboard_summary**: 获取平台统计概览

重要提示：
- 当用户提到任务名称而非ID时，应使用 query_tasks 的 name 参数搜索，或使用 get_task_detail 的 task_name 参数
- 当工具返回错误时，不要反复用相同参数重试，应换一种方式查询或告知用户

注意：当你不确定具体数据时，优先使用工具查询，而非编造数据。如果用户问的问题与平台无关，可以礼貌地说明你的职责范围。"""


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model_id: Optional[int] = None
    messages: List[ChatMessage]


MAX_TOOL_ROUNDS = 5


def _build_chat_model(model: ManagedModel, *, streaming: bool = True):
    """从 ManagedModel 构造 ChatOpenAI"""
    from langchain_openai import ChatOpenAI

    gen_config = model.generation_config or {}
    kwargs = {
        "model": model.model_name,
        "base_url": model.api_url.rstrip('/'),
        "api_key": model.api_key,
        "temperature": gen_config.get("temperature", 0.7),
        "max_tokens": gen_config.get("max_tokens", 2048),
        "streaming": streaming,
        "max_retries": gen_config.get("max_retries", 2),
        "timeout": gen_config.get("timeout", 120),
    }
    if "top_p" in gen_config:
        kwargs["top_p"] = gen_config["top_p"]
    return ChatOpenAI(**kwargs)


async def _get_model(request: ChatRequest, db: AsyncSession) -> ManagedModel:
    """查找可用模型，逻辑与原实现一致"""
    if request.model_id:
        result = await db.execute(
            select(ManagedModel).where(
                ManagedModel.id == request.model_id,
                ManagedModel.is_active == True,
            )
        )
        model = result.scalar_one_or_none()
    else:
        result = await db.execute(
            select(ManagedModel)
            .where(ManagedModel.is_default == True, ManagedModel.is_active == True)
            .limit(1)
        )
        model = result.scalar_one_or_none()
        if not model:
            result = await db.execute(
                select(ManagedModel)
                .where(ManagedModel.is_active == True)
                .limit(1)
            )
            model = result.scalar_one_or_none()

    if not model:
        raise HTTPException(status_code=400, detail="未找到可用模型，请先在模型管理中添加模型配置")

    if not model.api_url or not model.api_key:
        raise HTTPException(status_code=400, detail=f"模型 {model.name} 缺少 API URL 或 API Key 配置")

    if model.model_type not in ('openai_api', 'openai'):
        raise HTTPException(
            status_code=400,
            detail=f"AI 助手暂不支持 {model.model_type} 类型模型，请使用 OpenAI 兼容模型",
        )
    return model


def _is_tools_unsupported_error(error_msg: str) -> bool:
    """判断是否为 tools 参数不支持的错误"""
    msg_lower = (error_msg or "").lower()
    return any(
        kw in msg_lower
        for kw in [
            "does not support tools",
            "unsupported parameter: tools",
            "unknown parameter: tools",
            "tool_choice is not supported",
            "function calling is not supported",
            "tools are not supported",
        ]
    )


def _is_transient_stream_error(error: Exception) -> bool:
    """Return whether an upstream streaming response ended unexpectedly."""
    message = str(error).lower()
    return any(
        marker in message
        for marker in [
            "incomplete chunked read",
            "peer closed connection",
            "remoteprotocolerror",
            "server disconnected",
        ]
    )


def _extract_agent_content(result: dict) -> str:
    """Extract the final assistant text from a LangGraph agent result."""
    messages = result.get("messages", []) if isinstance(result, dict) else []
    for message in reversed(messages):
        content = getattr(message, "content", None)
        if isinstance(content, str) and content:
            return content
        if isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, str):
                    parts.append(block)
                elif isinstance(block, dict) and isinstance(block.get("text"), str):
                    parts.append(block["text"])
            if parts:
                return "".join(parts)
    return ""


def _parse_error(error_body: bytes, status_code: int) -> str:
    """解析 LLM API 错误响应"""
    try:
        error_json = json.loads(error_body)
        return error_json.get("error", {}).get("message", "") or str(error_json)
    except Exception:
        return f"LLM API 返回 HTTP {status_code}"


def _done_event(usage: dict, trace_url: Optional[str] = None) -> str:
    """构建 SSE done 事件"""
    event = {'done': True, 'usage': usage}
    if trace_url:
        event['trace_url'] = trace_url
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


@router.post("/")
async def chat_completion(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
):
    """流式聊天补全 - LangGraph ReAct Agent + Langfuse 自动 trace"""
    # 延迟导入，避免 langfuse/langchain 未安装时模块加载失败
    from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
    from langgraph.prebuilt import create_react_agent

    model = await _get_model(request, db)

    # 1. 构造 ChatOpenAI
    chat_model = _build_chat_model(model)

    # 2. 构造工具（闭包绑定 db）
    tools = _build_langchain_tools(db)

    # 3. 构造 Langfuse handler（per-request，未配置则跳过）
    handler = None
    trace_url: Optional[str] = None
    trace_name = "AI Chat"
    if _langfuse_enabled:
        try:
            from langfuse.langchain import CallbackHandler

            handler = CallbackHandler()
            user_msgs = [m.content for m in request.messages if m.role == 'user']
            trace_name = (user_msgs[-1][:50] + '...') if user_msgs else 'AI Chat'
        except Exception as e:
            logger.warning(f"Langfuse handler 初始化失败: {e}")
            handler = None

    # 4. 构造 ReAct agent
    agent = create_react_agent(
        model=chat_model,
        tools=tools,
        prompt=SYSTEM_PROMPT,
    )

    # 5. 构造初始消息
    init_messages = [SystemMessage(content=SYSTEM_PROMPT)]
    for m in request.messages:
        if m.role == "user":
            init_messages.append(HumanMessage(content=m.content))
        elif m.role == "assistant":
            init_messages.append(AIMessage(content=m.content))

    # 截断（保留 system + 最近 39 条）
    if len(init_messages) > 40:
        init_messages = [init_messages[0]] + init_messages[-39:]

    config = {
        "recursion_limit": MAX_TOOL_ROUNDS * 2 + 2,
    }
    if handler:
        config["callbacks"] = [handler]
        config["metadata"] = {
            "langfuse_trace_name": trace_name,
            "langfuse_tags": ["ai-chat"],
        }

    async def event_generator():
        nonlocal trace_url
        try:
            async for event in agent.astream_events(
                {"messages": init_messages}, config=config, version="v2"
            ):
                evt = event.get("event")
                if evt == "on_chat_model_stream":
                    chunk = event.get("data", {}).get("chunk")
                    if chunk and getattr(chunk, "content", ""):
                        yield f"data: {json.dumps({'content': chunk.content}, ensure_ascii=False)}\n\n"
                elif evt == "on_tool_start":
                    tool_name = event.get("name", "")
                    hint = f"\n正在查询 {tool_name}...\n\n"
                    yield f"data: {json.dumps({'content': hint}, ensure_ascii=False)}\n\n"
        except Exception as e:
            err_msg = str(e)
            logger.error(f"agent 流式异常: {err_msg}", exc_info=True)

            if _is_transient_stream_error(e):
                # Some OpenAI-compatible gateways occasionally terminate a
                # chunked response early. Retry once without streaming and
                # replace any partial text already delivered to the browser.
                try:
                    retry_agent = create_react_agent(
                        model=_build_chat_model(model, streaming=False),
                        tools=tools,
                        prompt=SYSTEM_PROMPT,
                    )
                    retry_result = await retry_agent.ainvoke(
                        {"messages": init_messages},
                        config={"recursion_limit": MAX_TOOL_ROUNDS * 2 + 2},
                    )
                    retry_content = _extract_agent_content(retry_result)
                    if not retry_content:
                        raise RuntimeError("模型重试成功，但未返回有效内容")
                    yield f"data: {json.dumps({'replace_content': retry_content}, ensure_ascii=False)}\n\n"
                except Exception as retry_err:
                    logger.error(f"上游流式断开后重试失败: {retry_err}", exc_info=True)
                    message = f"上游模型连接中断，自动重试失败: {retry_err}"
                    yield f"data: {json.dumps({'error': message}, ensure_ascii=False)}\n\n"
            # tools 不支持时降级为纯对话
            elif _is_tools_unsupported_error(err_msg):
                try:
                    fallback_agent = create_react_agent(
                        model=chat_model,
                        tools=[],
                        prompt=SYSTEM_PROMPT,
                    )
                    async for event in fallback_agent.astream_events(
                        {"messages": init_messages},
                        config=config if handler else {"recursion_limit": 4},
                        version="v2",
                    ):
                        if event.get("event") == "on_chat_model_stream":
                            chunk = event.get("data", {}).get("chunk")
                            if chunk and getattr(chunk, "content", ""):
                                yield f"data: {json.dumps({'content': chunk.content}, ensure_ascii=False)}\n\n"
                except Exception as fallback_err:
                    logger.error(f"降级 agent 失败: {fallback_err}", exc_info=True)
                    yield f"data: {json.dumps({'error': str(fallback_err)}, ensure_ascii=False)}\n\n"
            else:
                yield f"data: {json.dumps({'error': err_msg}, ensure_ascii=False)}\n\n"
        finally:
            # 获取 trace_url（通过 langfuse singleton）
            if handler and _langfuse_enabled:
                try:
                    from langfuse import get_client
                    lf = get_client()
                    last_id = getattr(handler, "last_trace_id", None)
                    if last_id:
                        trace_url = lf.get_trace_url(trace_id=last_id)
                    lf.flush()
                except Exception as e:
                    logger.debug(f"获取 trace_url 失败: {e}")
            yield _done_event({}, trace_url)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/langfuse-status")
async def langfuse_status():
    """返回 Langfuse 配置状态"""
    return {
        "enabled": _langfuse_enabled,
        "host": _langfuse_host,
    }
