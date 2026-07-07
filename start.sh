#!/bin/bash

# EvalScope Workflow 一键启动脚本
# 使用 conda evalscope 环境

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 目录设置
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  EvalScope Workflow 启动脚本${NC}"
echo -e "${GREEN}========================================${NC}"

# 清理可能占用端口的进程
echo -e "${YELLOW}清理占用端口的进程...${NC}"
for port in 5801 5900; do
    pid=$(lsof -t -i :$port 2>/dev/null)
    if [ -n "$pid" ]; then
        echo -e "  杀掉占用端口 $port 的进程 (PID: $pid)"
        kill -9 $pid 2>/dev/null
    fi
done
sleep 1

# 检查 conda 环境是否存在
if ! conda env list | grep -q "evalscope"; then
    echo -e "${RED}错误: 未找到 conda evalscope 环境${NC}"
    echo -e "${YELLOW}请先创建环境: conda create -n evalscope python=3.10${NC}"
    exit 1
fi

# 激活 conda evalscope 环境
echo -e "${YELLOW}激活 conda evalscope 环境...${NC}"
eval "$(conda shell.bash hook)"
conda activate evalscope

# Langfuse 可观测性配置（从 .env 文件读取，或手动 export）
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
fi

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}错误: 未找到 Node.js${NC}"
    exit 1
fi

echo -e "${YELLOW}正在启动后端服务 (端口 5900)...${NC}"
cd "$BACKEND_DIR"

# 启动后端
echo -e "${GREEN}后端服务启动中...${NC}"
python -m uvicorn main:app --host 0.0.0.0 --port 5900 &
BACKEND_PID=$!

echo -e "${GREEN}后端服务已启动 (PID: $BACKEND_PID)${NC}"

# 等待后端启动
sleep 3

echo -e "${YELLOW}正在启动前端服务 (端口 5801)...${NC}"
cd "$FRONTEND_DIR"

# 安装前端依赖
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}安装前端依赖...${NC}"
    npm install
fi

# 启动前端
echo -e "${GREEN}前端服务启动中...${NC}"
npm run dev &
FRONTEND_PID=$!

echo -e "${GREEN}前端服务已启动 (PID: $FRONTEND_PID)${NC}"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  服务已启动成功！${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "前端地址: ${GREEN}http://localhost:5801${NC}"
echo -e "后端地址: ${GREEN}http://localhost:5900${NC}"
echo -e "API 文档: ${GREEN}http://localhost:5900/docs${NC}"
echo ""
echo -e "按 ${YELLOW}Ctrl+C${NC} 停止所有服务"
echo ""

# 捕获 Ctrl+C 并停止所有服务
cleanup() {
    echo ""
    echo -e "${YELLOW}正在停止服务...${NC}"
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    conda deactivate 2>/dev/null
    echo -e "${GREEN}服务已停止${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

# 等待
wait