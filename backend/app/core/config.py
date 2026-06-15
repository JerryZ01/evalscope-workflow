"""
应用配置管理
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    """应用配置"""
    model_config = SettingsConfigDict(extra='ignore')  # 允许额外的环境变量

    # 应用基础
    APP_NAME: str = "EvalScope Workflow"
    DEBUG: bool = True
    VERSION: str = "1.0.0"

    # 服务器
    HOST: str = "0.0.0.0"
    PORT: int = 5900

    # 数据库
    DATABASE_URL: str = "sqlite+aiosqlite:///./evalscope.db"

    # Redis (Celery)
    REDIS_URL: str = "redis://localhost:6379/0"

    # EvalScope 配置
    EVALSCOPE_DATASET_DIR: str = "./data/datasets"
    EVALSCOPE_WORK_DIR: str = "./data/work"
    EVALSCOPE_USE_CACHE: bool = True

    # Celery 配置
    CELERY_BROKER_URL: str = "redis://localhost:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/0"

    # CORS
    CORS_ORIGINS: list = ["*"]


@lru_cache()
def get_settings() -> Settings:
    """获取配置单例"""
    return Settings()


settings = get_settings()