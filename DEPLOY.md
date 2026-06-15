# EvalScope Workflow — 部署指南

> 一行 `docker compose up -d --build` 起全栈。

## 一、环境要求

| 组件 | 最低版本 | 说明 |
|---|---|---|
| Docker | 20.10+ | 已自带 BuildKit |
| Docker Compose | v2.x (`docker compose`) | 注意是 v2 plugin，不是老的 `docker-compose` |
| OS | Linux / macOS / Windows WSL2 | 任一 |
| 磁盘 | ≥ 5 GB | 评测输出、数据集缓存会随使用累积 |
| 端口 | 5801（前端）、5900（后端，可选不暴露） | 与宿主已有进程不冲突即可，端口可在 `.env` 改 |

> 编程类评测（数据集 `need_sandbox=true`）需要后端容器调宿主 docker 起沙箱。compose 文件已 mount 了 `/var/run/docker.sock`，**如果你不跑这类评测，可以把这一行注释掉以提升安全性**。

## 二、快速开始（3 步）

```bash
# 1. 拉代码
git clone <your-repo-url> evalscope-workflow
cd evalscope-workflow

# 2. 准备配置（可直接用默认值）
cp .env.example .env

# 3. 构建并启动
docker compose up -d --build
```

启动完成后：

- 前端：<http://localhost:5801>
- 后端 API 文档：<http://localhost:5900/docs>
- 健康检查：`docker compose ps` 看两个服务都是 `healthy`

## 三、目录结构

启动后会在仓库根目录生成 `data/`，是所有持久化数据的根：

```
evalscope-workflow/
├── data/
│   ├── db/             # sqlite 数据库（任务、模型管理、配置）
│   ├── outputs/        # 评测产生的报告、日志、结果 JSON
│   └── datasets/       # evalscope 下载的数据集缓存
├── docker-compose.yml
├── .env
├── backend/Dockerfile
├── frontend/Dockerfile
└── frontend/nginx.conf
```

**这三个目录都已通过 volume 持久化**，删容器、升级版本都不会丢数据。

## 四、配置项说明

所有配置都在 `.env` 文件里。需要修改时编辑文件后 `docker compose up -d` 即可生效（不需要 rebuild）。

| 变量 | 默认 | 含义 |
|---|---|---|
| `FRONTEND_PORT` | 5801 | 宿主侧前端端口 |
| `BACKEND_PORT` | 5900 | 宿主侧后端端口（可选不映射） |
| `DEBUG` | false | 后端日志详细程度，生产建议 false |
| `DATABASE_URL` | sqlite | 默认 sqlite 即可；要切 PostgreSQL 改这里 + requirements |
| `EVALSCOPE_USE_CACHE` | true | 数据集复用缓存，加快重复评测 |
| `CORS_ORIGINS` | `["*"]` | **生产建议改成具体前端域名**，避免任意来源调 API |

## 五、常用运维命令

```bash
# 启动
docker compose up -d

# 重新构建后启动（改了 Dockerfile/代码后）
docker compose up -d --build

# 停止
docker compose down

# 停止 + 清空数据（慎用，会删 db/outputs/datasets）
docker compose down -v
rm -rf data/

# 看日志
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f --tail=200

# 单独重启某个服务
docker compose restart backend

# 进容器排查
docker compose exec backend bash
docker compose exec frontend sh

# 查看服务状态
docker compose ps
```

## 六、升级流程

```bash
# 1. 拉新代码
git pull

# 2. 重新构建并热替换（保留数据）
docker compose up -d --build

# 3. 看日志确认无报错
docker compose logs -f backend
```

由于 `data/` 通过 volume 持久化，升级**不会丢任务、模型管理配置、评测报告**。

## 七、常见问题

### Q1: SSE 进度推送收不到 / 任务详情页状态不刷新？

`nginx.conf` 里 `/api/eval/stream/` 已经关闭了 `proxy_buffering`，正常情况下不会有问题。如果你换了反代（如外层再套了一层 nginx / Cloudflare），务必检查它们是否也关了缓冲——SSE 对中间链路的 buffer 极度敏感。

### Q2: 编程类评测启动失败？

确认两点：
1. 宿主 docker 已运行
2. `docker-compose.yml` 里 `/var/run/docker.sock` 这一行未被注释

如果不需要跑编程评测，注释掉这行更安全。

### Q3: 模型管理里的 API Key 怎么存的？安全吗？

存在 sqlite 里明文。**生产环境建议**：
- 数据库文件所在目录权限设 `chmod 700 data/db`
- 不要把 `data/` 提交进 git（默认已通过 `.gitignore` 排除）
- 如果有更高安全要求，可改用 Vault / AWS Secrets Manager 注入到 env

### Q4: 想暴露到公网？

1. `.env` 把 `CORS_ORIGINS` 改成你的具体前端域名
2. 在 docker-compose 外层加一个反代（nginx / Caddy / Traefik）做 HTTPS 终结
3. `BACKEND_PORT` 注释掉，**后端不暴露给宿主**，只通过容器内 network 给 frontend
4. 开启基础认证或 SSO（当前平台无内置鉴权，需在反代层做）

### Q5: 容器一直 unhealthy？

```bash
# 看后端启动日志
docker compose logs --tail=200 backend

# 常见：evalscope 包下载慢导致首次启动超 healthcheck 起始时间
# 可临时改 backend/Dockerfile 的 HEALTHCHECK --start-period=60s
```

### Q6: 想跑在 Kubernetes / Swarm 上？

当前 compose 文件可作为起点。注意：
- sqlite 不适合多副本，迁 PostgreSQL
- `docker.sock` mount 在 K8s 上需要 DinD 或 sysbox runtime
- frontend nginx 配置可直接复用

## 八、本地开发模式

不想用 docker，仍要本地跑 dev server，用项目根目录的 `start.sh`：

```bash
bash start.sh
```

这会在 conda `evalscope` 环境里启 uvicorn（5900）+ vite（5801）。改代码自动热更。仅推荐 dev，不要用于生产。

## 九、卸载

```bash
docker compose down --rmi local -v
rm -rf data/
```

清掉容器、镜像、volume、本地数据。
