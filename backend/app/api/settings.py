"""
Settings API - 系统设置管理

设置持久化到 JSON 文件，重启后保留。
设置变化会同步到运行时配置，影响后续评测任务。
"""
import json
import logging
import os
from typing import Dict, Any, Optional
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.config import settings as app_settings

logger = logging.getLogger(__name__)
router = APIRouter()


class SettingsUpdate(BaseModel):
    """设置更新请求"""
    output_dir: Optional[str] = None
    dataset_dir: Optional[str] = None
    use_cache: Optional[bool] = None
    debug: Optional[bool] = None


class SettingsResponse(BaseModel):
    """设置响应"""
    output_dir: str
    dataset_dir: str
    use_cache: bool
    debug: bool


# 默认配置
DEFAULT_SETTINGS: Dict[str, Any] = {
    "output_dir": app_settings.EVALSCOPE_WORK_DIR,
    "dataset_dir": app_settings.EVALSCOPE_DATASET_DIR,
    "use_cache": app_settings.EVALSCOPE_USE_CACHE,
    "debug": app_settings.DEBUG,
}

# 设置文件路径（持久化到 backend 目录下）
SETTINGS_FILE = Path(app_settings.SETTINGS_FILE).expanduser().resolve()


def _load_settings() -> Dict[str, Any]:
    """从文件加载设置，失败则使用默认值"""
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
            values = {**DEFAULT_SETTINGS, **data}
            # Deployment environment variables take precedence over local JSON.
            env_overrides = {
                "EVALSCOPE_WORK_DIR": "output_dir",
                "EVALSCOPE_DATASET_DIR": "dataset_dir",
                "EVALSCOPE_USE_CACHE": "use_cache",
                "DEBUG": "debug",
            }
            for env_name, field in env_overrides.items():
                if env_name in os.environ:
                    values[field] = DEFAULT_SETTINGS[field]
            return values
        except Exception as e:
            logger.warning(f"加载设置文件失败，使用默认值: {e}")
    return dict(DEFAULT_SETTINGS)


def _save_settings(settings: Dict[str, Any]) -> None:
    """保存设置到文件"""
    try:
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(settings, f, indent=2, ensure_ascii=False)
        logger.info(f"设置已保存到 {SETTINGS_FILE}")
    except Exception as e:
        logger.error(f"保存设置文件失败: {e}")
        raise


# 内存中的设置（启动时从文件加载）
_settings_store: Dict[str, Any] = _load_settings()


def _apply_runtime_settings(values: Dict[str, Any]) -> None:
    app_settings.EVALSCOPE_WORK_DIR = values["output_dir"]
    app_settings.EVALSCOPE_DATASET_DIR = values["dataset_dir"]
    app_settings.EVALSCOPE_USE_CACHE = values["use_cache"]
    app_settings.DEBUG = values["debug"]


_apply_runtime_settings(_settings_store)


def get_current_settings() -> Dict[str, Any]:
    """获取当前设置（供其他模块使用）"""
    return dict(_settings_store)


@router.get("", response_model=SettingsResponse)
async def get_settings() -> SettingsResponse:
    """获取系统设置"""
    return SettingsResponse(**_settings_store)


@router.post("", response_model=SettingsResponse)
async def update_settings(settings: SettingsUpdate) -> SettingsResponse:
    """更新系统设置（持久化到文件）"""
    global _settings_store

    # 只更新非 None 的字段
    update_data = settings.model_dump(exclude_unset=True, exclude_none=True)
    _settings_store.update(update_data)
    _apply_runtime_settings(_settings_store)

    # 持久化到文件
    _save_settings(_settings_store)

    logger.info(f"系统设置已更新: {update_data}")
    return SettingsResponse(**_settings_store)


@router.post("/reset", response_model=SettingsResponse)
async def reset_settings() -> SettingsResponse:
    """重置设置为默认值"""
    global _settings_store

    _settings_store = dict(DEFAULT_SETTINGS)
    _apply_runtime_settings(_settings_store)
    _save_settings(_settings_store)

    logger.info("系统设置已重置为默认值")
    return SettingsResponse(**_settings_store)
