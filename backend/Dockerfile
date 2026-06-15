# ============================================================
# EvalScope Workflow — Backend Image
# ============================================================
FROM python:3.10-slim

LABEL maintainer="EvalScope Workflow"
LABEL description="FastAPI + evalscope backend"

# 系统依赖：sqlite client (debug)、curl (healthcheck)、git (有些 pip 包要用)
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        sqlite3 \
        git \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 从官方镜像拷贝 uv 二进制（无需多走一次网络）
COPY --from=ghcr.io/astral-sh/uv:0.9.4 /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# 先复制锁文件,利用 Docker layer cache
COPY backend/pyproject.toml backend/uv.lock backend/.python-version /app/
RUN uv sync --frozen --no-dev --no-install-project

# 复制应用代码（.dockerignore 已排除无关文件）
COPY backend/ /app/

# 数据目录（sqlite db、outputs、datasets 都通过 volume mount 进来）
RUN mkdir -p /app/data/db /app/outputs /app/data/datasets

# 默认配置（可被 .env / docker-compose env 覆盖）
ENV HOST=0.0.0.0 \
    PORT=5900 \
    DATABASE_URL=sqlite+aiosqlite:////app/data/db/evalscope.db \
    EVALSCOPE_DATASET_DIR=/app/data/datasets \
    EVALSCOPE_WORK_DIR=/app/outputs

EXPOSE 5900

# 健康检查：tcp 端口可达即可（GET / 可能返回 404，但服务确实活着）
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:5900/docs >/dev/null || exit 1

CMD ["sh", "-c", "uvicorn main:app --host ${HOST} --port ${PORT}"]
