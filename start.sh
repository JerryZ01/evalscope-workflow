#!/bin/bash

# EvalScope Workflow one-click development launcher.

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
PREFERRED_BACKEND_PORT="${BACKEND_PORT:-5900}"
PREFERRED_FRONTEND_PORT="${FRONTEND_PORT:-5801}"
BACKEND_PID=''
FRONTEND_PID=''

port_pids() {
    lsof -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null
}

port_is_free() {
    [ -z "$(port_pids "$1")" ]
}

release_port() {
    local port="$1"
    local pids
    pids="$(port_pids "$port")"
    [ -z "$pids" ] && return 0

    echo -e "${YELLOW}端口 $port 已被占用，正在停止进程: $pids${NC}"
    kill $pids 2>/dev/null || true

    for _ in {1..10}; do
        port_is_free "$port" && return 0
        sleep 0.2
    done

    pids="$(port_pids "$port")"
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
    sleep 0.5
    port_is_free "$port"
}

find_free_port() {
    local port="$1"
    local limit=$((port + 20))
    while [ "$port" -le "$limit" ]; do
        if port_is_free "$port"; then
            echo "$port"
            return 0
        fi
        port=$((port + 1))
    done
    return 1
}

wait_for_url() {
    local name="$1"
    local url="$2"
    local pid="$3"
    local attempts="${4:-120}"

    for ((attempt = 1; attempt <= attempts; attempt++)); do
        if ! kill -0 "$pid" 2>/dev/null; then
            echo -e "${RED}$name 进程已退出，请检查上方日志。${NC}"
            return 1
        fi
        if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
            return 0
        fi
        sleep 0.5
    done

    echo -e "${RED}$name 启动超时: $url${NC}"
    return 1
}

stop_process() {
    local pid="$1"
    local child
    [ -z "$pid" ] && return

    for child in $(pgrep -P "$pid" 2>/dev/null); do
        stop_process "$child"
    done
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
}

cleanup() {
    local exit_code=$?
    trap - EXIT INT TERM
    echo ""
    echo -e "${YELLOW}正在停止服务...${NC}"
    stop_process "$FRONTEND_PID"
    stop_process "$BACKEND_PID"
    if [ -n "${CONDA_PREFIX:-}" ] && command -v conda >/dev/null 2>&1; then
        conda deactivate 2>/dev/null || true
    fi
    echo -e "${GREEN}服务已停止${NC}"
    exit "$exit_code"
}

trap cleanup EXIT INT TERM

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  EvalScope Workflow 启动脚本${NC}"
echo -e "${GREEN}========================================${NC}"

for command_name in lsof curl pgrep node npm; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo -e "${RED}错误: 未找到 $command_name${NC}"
        exit 1
    fi
done

# Load optional observability and application configuration.
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$SCRIPT_DIR/.env"
    set +a
fi

if [ -x "$BACKEND_DIR/.venv/bin/python" ]; then
    PYTHON_BIN="$BACKEND_DIR/.venv/bin/python"
else
    if ! command -v conda >/dev/null 2>&1 || ! conda env list | grep -qE '^evalscope[[:space:]]'; then
        echo -e "${RED}错误: 未找到 backend/.venv，也未找到 conda evalscope 环境${NC}"
        exit 1
    fi
    echo -e "${YELLOW}激活 conda evalscope 环境...${NC}"
    eval "$(conda shell.bash hook)"
    conda activate evalscope
    PYTHON_BIN="$(command -v python)"
fi

BACKEND_PORT="$PREFERRED_BACKEND_PORT"
if ! release_port "$BACKEND_PORT"; then
    BACKEND_PORT="$(find_free_port "$((PREFERRED_BACKEND_PORT + 1))")" || {
        echo -e "${RED}错误: 找不到可用的后端端口${NC}"
        exit 1
    }
    echo -e "${YELLOW}端口 $PREFERRED_BACKEND_PORT 无法释放，后端改用 $BACKEND_PORT。${NC}"
fi

FRONTEND_PORT="$PREFERRED_FRONTEND_PORT"
if ! release_port "$FRONTEND_PORT"; then
    FRONTEND_PORT="$(find_free_port "$((PREFERRED_FRONTEND_PORT + 1))")" || {
        echo -e "${RED}错误: 找不到可用的前端端口${NC}"
        exit 1
    }
    echo -e "${YELLOW}端口 $PREFERRED_FRONTEND_PORT 无法释放，前端改用 $FRONTEND_PORT。${NC}"
fi

echo -e "${YELLOW}正在启动后端服务 (端口 $BACKEND_PORT)...${NC}"
cd "$BACKEND_DIR"
"$PYTHON_BIN" -m uvicorn main:app --host 0.0.0.0 --port "$BACKEND_PORT" &
BACKEND_PID=$!

if ! wait_for_url "后端" "http://127.0.0.1:$BACKEND_PORT/health" "$BACKEND_PID" 240; then
    exit 1
fi

echo -e "${YELLOW}正在启动前端服务 (端口 $FRONTEND_PORT)...${NC}"
cd "$FRONTEND_DIR"
if [ ! -d node_modules ]; then
    echo -e "${YELLOW}安装前端依赖...${NC}"
    npm install
fi

VITE_BACKEND_TARGET="http://127.0.0.1:$BACKEND_PORT" \
    npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" --strictPort &
FRONTEND_PID=$!

if ! wait_for_url "前端" "http://127.0.0.1:$FRONTEND_PORT/" "$FRONTEND_PID" 120; then
    exit 1
fi
if ! curl -fsS --max-time 3 "http://127.0.0.1:$FRONTEND_PORT/health" >/dev/null; then
    echo -e "${RED}错误: 前端已启动，但无法通过代理访问后端。${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  服务已启动并通过健康检查${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "前端地址: ${GREEN}http://localhost:$FRONTEND_PORT${NC}"
echo -e "后端地址: ${GREEN}http://localhost:$BACKEND_PORT${NC}"
echo -e "API 文档: ${GREEN}http://localhost:$BACKEND_PORT/docs${NC}"
echo ""
echo -e "按 ${YELLOW}Ctrl+C${NC} 停止所有服务"
echo ""

# Exit when either service exits; the EXIT trap stops the other one.
wait -n "$BACKEND_PID" "$FRONTEND_PID"
