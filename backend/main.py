"""
EvalScope 工作流引擎后端入口
"""
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import tasks, catalog, eval as eval_api, results, models, settings
from app.db.database import engine, Base
from app.core.config import settings as app_settings

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时
    logger.info("正在初始化数据库...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("数据库初始化完成")

    # 缓存数据集目录
    from evalscope_wrapper.registry import EvalScopeRegistry
    try:
        datasets = EvalScopeRegistry.get_all_datasets()
        logger.info(f"已加载 {len(datasets)} 个数据集")
    except Exception as e:
        logger.warning(f"加载数据集失败: {e}")

    yield

    # 关闭时
    logger.info("正在关闭应用...")


# 创建 FastAPI 应用
app = FastAPI(
    title="EvalScope Workflow API",
    description="评测工作流引擎后端 API",
    version="1.0.0",
    lifespan=lifespan
)

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应该限制域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(tasks.router, prefix="/api/tasks", tags=["任务管理"])
app.include_router(catalog.router, prefix="/api/catalog", tags=["目录信息"])
app.include_router(eval_api.router, prefix="/api/eval", tags=["评测执行"])
app.include_router(results.router, prefix="/api/results", tags=["评测结果"])
app.include_router(models.router, prefix="/api/models", tags=["模型管理"])
app.include_router(settings.router, prefix="/api/settings", tags=["系统设置"])

# 注册 settings（配置对象）
app.state.settings = app_settings

# 挂载静态文件目录（用于评测报告的图表库）
static_dir = os.path.join(os.path.dirname(__file__), "app", "static")
if os.path.isdir(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/health")
async def health_check():
    """健康检查"""
    return {
        "status": "healthy",
        "version": "1.0.0",
        "service": "evalscope-workflow"
    }


@app.get("/")
async def root():
    """根路径"""
    return {
        "message": "EvalScope Workflow API",
        "docs": "/docs"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=app_settings.HOST,
        port=app_settings.PORT,
        reload=app_settings.DEBUG
    )