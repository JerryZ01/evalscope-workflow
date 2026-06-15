"""
模型管理 API 路由
"""
import json
import logging
import time
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db.models import ManagedModel
from app.schemas.managed_model import (
    ManagedModelCreate,
    ManagedModelUpdate,
    ManagedModelResponse,
    ManagedModelListResponse,
    ManagedModelBriefResponse
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("", response_model=ManagedModelListResponse)
async def list_models(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    active_only: bool = Query(True, description="只返回活跃模型"),
    db: AsyncSession = Depends(get_db)
):
    """获取模型列表"""
    query = select(ManagedModel).order_by(ManagedModel.is_default.desc(), ManagedModel.use_count.desc())

    if active_only:
        query = query.where(ManagedModel.is_active == True)

    query = query.offset(skip).limit(limit)

    result = await db.execute(query)
    models = result.scalars().all()

    return ManagedModelListResponse(
        total=len(models),
        models=[ManagedModelResponse.model_validate(m) for m in models]
    )


@router.get("/brief", response_model=List[ManagedModelBriefResponse])
async def list_models_brief(
    active_only: bool = Query(True),
    db: AsyncSession = Depends(get_db)
):
    """获取简要模型列表（用于下拉选择）"""
    query = select(ManagedModel).order_by(ManagedModel.is_default.desc())

    if active_only:
        query = query.where(ManagedModel.is_active == True)

    result = await db.execute(query)
    models = result.scalars().all()

    return [ManagedModelBriefResponse.model_validate(m) for m in models]


@router.get("/default", response_model=Optional[ManagedModelBriefResponse])
async def get_default_model(
    db: AsyncSession = Depends(get_db)
):
    """获取默认模型"""
    result = await db.execute(
        select(ManagedModel).where(
            ManagedModel.is_default == True,
            ManagedModel.is_active == True
        ).limit(1)
    )
    model = result.scalar_one_or_none()

    if not model:
        return None

    return ManagedModelBriefResponse.model_validate(model)


@router.get("/{model_id}", response_model=ManagedModelResponse)
async def get_model(
    model_id: int,
    db: AsyncSession = Depends(get_db)
):
    """获取模型详情"""
    result = await db.execute(
        select(ManagedModel).where(ManagedModel.id == model_id)
    )
    model = result.scalar_one_or_none()

    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"模型 {model_id} 不存在"
        )

    return ManagedModelResponse.model_validate(model)


@router.post("", response_model=ManagedModelResponse, status_code=status.HTTP_201_CREATED)
async def create_model(
    model_data: ManagedModelCreate,
    db: AsyncSession = Depends(get_db)
):
    """创建模型"""
    # 如果设为默认，先取消其他默认
    if model_data.is_default:
        await db.execute(
            update(ManagedModel).where(ManagedModel.is_default == True).values(is_default=False)
        )

    # 检查同名模型是否已存在
    result = await db.execute(
        select(ManagedModel).where(
            ManagedModel.name == model_data.name
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"模型名称 '{model_data.name}' 已存在"
        )

    model = ManagedModel(
        name=model_data.name,
        model_type=model_data.model_type,
        model_name=model_data.model_name,
        api_url=model_data.api_url,
        api_key=model_data.api_key,
        generation_config=model_data.generation_config,
        description=model_data.description,
        is_default=model_data.is_default,
        is_active=True,
        use_count=0
    )

    db.add(model)
    await db.commit()
    await db.refresh(model)

    return ManagedModelResponse.model_validate(model)


@router.patch("/{model_id}", response_model=ManagedModelResponse)
async def update_model(
    model_id: int,
    model_data: ManagedModelUpdate,
    db: AsyncSession = Depends(get_db)
):
    """更新模型"""
    result = await db.execute(
        select(ManagedModel).where(ManagedModel.id == model_id)
    )
    model = result.scalar_one_or_none()

    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"模型 {model_id} 不存在"
        )

    # 如果设为默认，先取消其他默认
    if model_data.is_default:
        await db.execute(
            update(ManagedModel).where(
                ManagedModel.is_default == True,
                ManagedModel.id != model_id
            ).values(is_default=False)
        )

    update_data = model_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(model, field, value)

    await db.commit()
    await db.refresh(model)

    return ManagedModelResponse.model_validate(model)


@router.delete("/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_model(
    model_id: int,
    db: AsyncSession = Depends(get_db)
):
    """删除模型"""
    result = await db.execute(
        select(ManagedModel).where(ManagedModel.id == model_id)
    )
    model = result.scalar_one_or_none()

    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"模型 {model_id} 不存在"
        )

    await db.delete(model)
    await db.commit()


@router.post("/{model_id}/set-default", response_model=ManagedModelResponse)
async def set_default_model(
    model_id: int,
    db: AsyncSession = Depends(get_db)
):
    """设为默认模型"""
    result = await db.execute(
        select(ManagedModel).where(ManagedModel.id == model_id)
    )
    model = result.scalar_one_or_none()

    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"模型 {model_id} 不存在"
        )

    # 取消其他默认
    await db.execute(
        update(ManagedModel).where(ManagedModel.is_default == True).values(is_default=False)
    )

    model.is_default = True
    await db.commit()
    await db.refresh(model)

    return ManagedModelResponse.model_validate(model)


TEST_PROMPT = "你好，请用一句话回复。"


def _mask_api_key(key: Optional[str]) -> str:
    """对 API Key 做脱敏，保留首尾各 4 位"""
    if not key:
        return ""
    if len(key) <= 8:
        return "*" * len(key)
    return f"{key[:4]}{'*' * (len(key) - 8)}{key[-4:]}"


def _extract_content(data: dict) -> str:
    """从 OpenAI 兼容 chat 响应中提取首条 message.content / text"""
    try:
        choices = data.get("choices") or []
        if not choices:
            return ""
        first = choices[0]
        msg = first.get("message") or {}
        if msg.get("content"):
            return msg["content"]
        # 兼容 text 字段（旧版 completions）
        if first.get("text"):
            return first["text"]
        # 兼容工具调用：返回 tool_calls 的字符串化
        if msg.get("tool_calls"):
            return f"[tool_calls] {msg['tool_calls']}"
        # 推理模型：max_tokens 不足时可能只有 reasoning_content
        if msg.get("reasoning_content"):
            return f"[仅推理内容，未输出最终回复]\n{msg['reasoning_content']}"
    except Exception:
        pass
    return ""


def _extract_anthropic_content(data: dict) -> str:
    """从 Anthropic Messages API 响应中提取内容"""
    try:
        content = data.get("content") or []
        if not content:
            return ""
        # Anthropic 返回 content 数组，每项有 type 和 text
        text_parts = []
        for item in content:
            if item.get("type") == "text" and item.get("text"):
                text_parts.append(item["text"])
        return "".join(text_parts)
    except Exception:
        pass
    return ""


def _parse_sse_stream(text: str) -> tuple[str, str, list[dict]]:
    """
    解析 SSE 流式响应文本。
    返回 (聚合后的 content, 聚合后的 reasoning_content, 原始 chunks)
    """
    chunks: list[dict] = []
    content_parts: list[str] = []
    reasoning_parts: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith(":"):
            continue
        if line.startswith("data:"):
            line = line[5:].strip()
        if line in ("[DONE]", ""):
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        chunks.append(obj)
        try:
            delta = (obj.get("choices") or [{}])[0].get("delta") or {}
            if delta.get("content"):
                content_parts.append(delta["content"])
            if delta.get("reasoning_content"):
                reasoning_parts.append(delta["reasoning_content"])
        except Exception:
            pass
    return "".join(content_parts), "".join(reasoning_parts), chunks


@router.post("/{model_id}/test")
async def test_model_connection(
    model_id: int,
    stream: bool = Query(False, description="是否使用流式调用"),
    db: AsyncSession = Depends(get_db)
):
    """
    测试模型连接是否正常，返回完整的请求与响应明细
    """
    result = await db.execute(
        select(ManagedModel).where(ManagedModel.id == model_id)
    )
    model = result.scalar_one_or_none()

    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"模型 {model_id} 不存在"
        )

    base_response = {
        "success": False,
        "latency_ms": 0.0,
        "stream": stream,
        "request": None,
        "response": None,
        "error": None,
    }

    if model.model_type not in ('openai_api', 'anthropic_api'):
        base_response["error"] = f"暂不支持 {model.model_type} 类型的连接测试"
        return base_response

    if not model.api_url:
        base_response["error"] = "API URL 未配置"
        return base_response

    base_url = model.api_url.rstrip('/')

    # 根据 model_type 构建不同的请求
    if model.model_type == 'anthropic_api':
        # Anthropic API 使用 Messages API 格式
        chat_url = f"{base_url}/v1/messages"
        masked_headers = {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01"
        }
        real_headers = {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01"
        }
        if model.api_key:
            masked_headers["x-api-key"] = _mask_api_key(model.api_key)
            real_headers["x-api-key"] = model.api_key

        payload = {
            "model": model.model_name,
            "max_tokens": 512,
            "messages": [{"role": "user", "content": TEST_PROMPT}],
        }
        gen = model.generation_config or {}
        for k in ("temperature", "top_p"):
            if k in gen and gen[k] is not None:
                payload[k] = gen[k]
    else:
        # OpenAI API 格式
        chat_url = f"{base_url}/chat/completions"
        masked_headers = {"Content-Type": "application/json"}
        real_headers = {"Content-Type": "application/json"}
        if model.api_key:
            masked_headers["Authorization"] = f"Bearer {_mask_api_key(model.api_key)}"
            real_headers["Authorization"] = f"Bearer {model.api_key}"

        payload = {
            "model": model.model_name,
            "messages": [{"role": "user", "content": TEST_PROMPT}],
            "max_tokens": 512,
            "stream": stream,
        }
        gen = model.generation_config or {}
        for k in ("temperature", "top_p"):
            if k in gen and gen[k] is not None:
                payload[k] = gen[k]

    base_response["request"] = {
        "method": "POST",
        "url": chat_url,
        "headers": masked_headers,
        "payload": payload,
    }

    start_time = time.time()
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            if stream:
                # 流式：用 stream 上下文聚合 chunks
                raw_text_parts = []
                async with client.stream("POST", chat_url, headers=real_headers, json=payload) as resp:
                    async for line in resp.aiter_lines():
                        raw_text_parts.append(line)
                    status_code = resp.status_code
                    resp_headers = dict(resp.headers)

                latency_ms = round((time.time() - start_time) * 1000, 1)
                raw_text = "\n".join(raw_text_parts)
                aggregated_content, reasoning_content, chunks = _parse_sse_stream(raw_text)

                # 如果模型只输出推理内容（max_tokens 用完时），把推理内容作为回退内容显示
                display_content = aggregated_content or (
                    f"[仅推理内容，未输出最终回复]\n{reasoning_content}" if reasoning_content else ""
                )

                base_response["latency_ms"] = latency_ms
                base_response["response"] = {
                    "status_code": status_code,
                    "headers": resp_headers,
                    "raw": raw_text[:8000],  # 截断保护
                    "chunks_count": len(chunks),
                    "content": display_content,
                    "body": None,
                }
                if 200 <= status_code < 300 and chunks:
                    base_response["success"] = True
                else:
                    base_response["error"] = f"HTTP {status_code}" + (
                        "，未解析到任何 chunk" if not chunks else ""
                    )
                return base_response
            else:
                response = await client.post(chat_url, headers=real_headers, json=payload)

        latency_ms = round((time.time() - start_time) * 1000, 1)
        base_response["latency_ms"] = latency_ms

        resp_headers = dict(response.headers)
        try:
            body = response.json()
            if model.model_type == 'anthropic_api':
                extracted = _extract_anthropic_content(body) if isinstance(body, dict) else ""
            else:
                extracted = _extract_content(body) if isinstance(body, dict) else ""
        except Exception:
            body = response.text[:8000]
            extracted = ""

        base_response["response"] = {
            "status_code": response.status_code,
            "headers": resp_headers,
            "body": body,
            "content": extracted,
            "raw": None,
        }
        if 200 <= response.status_code < 300:
            base_response["success"] = True
        else:
            err_preview = response.text[:200] if hasattr(response, "text") else ""
            base_response["error"] = f"HTTP {response.status_code}: {err_preview}"
        return base_response

    except httpx.ConnectError as e:
        latency_ms = round((time.time() - start_time) * 1000, 1)
        base_response["latency_ms"] = latency_ms
        base_response["error"] = f"连接失败：无法连接到 {model.api_url}（{e}）"
        return base_response
    except httpx.TimeoutException:
        base_response["latency_ms"] = 30000.0
        base_response["error"] = "连接超时 (30s)"
        return base_response
    except Exception as e:
        latency_ms = round((time.time() - start_time) * 1000, 1)
        base_response["latency_ms"] = latency_ms
        logger.warning(f"模型连接测试异常: {e}")
        base_response["error"] = f"测试失败：{e}"
        return base_response


@router.post("/{model_id}/use", response_model=ManagedModelResponse)
async def record_model_usage(
    model_id: int,
    db: AsyncSession = Depends(get_db)
):
    """记录模型使用"""
    result = await db.execute(
        select(ManagedModel).where(ManagedModel.id == model_id)
    )
    model = result.scalar_one_or_none()

    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"模型 {model_id} 不存在"
        )

    model.use_count += 1
    await db.commit()
    await db.refresh(model)

    return ManagedModelResponse.model_validate(model)