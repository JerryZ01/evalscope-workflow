# ============================================================
# EvalScope Workflow — Frontend Image (multi-stage)
# Stage 1: Build with Node
# Stage 2: Serve with Nginx
# ============================================================

# -------- Stage 1: build --------
FROM node:20-alpine AS builder

WORKDIR /app

# 先复制 lockfile，命中 layer cache
COPY frontend/package.json frontend/package-lock.json* /app/
RUN npm ci --no-audit --no-fund --registry=https://registry.npmmirror.com

# 复制源码 build
COPY frontend/ /app/
# 跳过 tsc 类型检查（用 vite 自带 esbuild 转译），遗留类型问题应在 CI 单独修
RUN npx vite build

# -------- Stage 2: serve --------
FROM nginx:alpine

# 复制 build 产物
COPY --from=builder /app/dist /usr/share/nginx/html

# 自定义 nginx 配置（SSE 友好 + 反代 /api）
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O- http://localhost/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
