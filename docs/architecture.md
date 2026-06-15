# 系统架构

## 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                        用户浏览器                         │
│           React SPA (Ant Design UI + Zustand)            │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP / SSE
┌────────────────────────▼────────────────────────────────┐
│                    FastAPI 后端 (:8000)                   │
│  ┌────────────────────────────────────────────────────┐ │
│  │                  API Routes                         │ │
│  │  /api/tasks   /api/eval   /api/results             │ │
│  │  /api/catalog /api/models /api/settings            │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │  SSEManager  │  EvalScopeRunner │  CatalogService  │  │
│  │  (内存广播)  │  (异步评测执行) │  (数据集/模型注册) │  │
│  └──────────┘  └──────────┘  └──────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐ │
│  │           SQLAlchemy AsyncSession                   │ │
│  │         (aiosqlite → evalscope.db)                 │ │
│  └────────────────────────────────────────────────────┘ │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                    文件系统                              │
│  outputs/task_{id}/{timestamp}/                         │
│    ├── configs/task_config.yaml                        │
│    ├── logs/eval_log.log                               │
│    ├── predictions/{model}/{dataset}.jsonl             │
│    ├── reports/{model}/{dataset}.json (评分数据)        │
│    └── reports/report.html (可视化报告)                  │
└─────────────────────────────────────────────────────────┘
```

## 目录结构

```
evalscope-workflow/
├── backend/
│   ├── main.py                      # FastAPI 入口，路由注册，静态文件挂载
│   ├── requirements.txt
│   ├── evalscope.db                 # SQLite 数据库（运行时创建）
│   ├── app/
│   │   ├── api/                     # API 路由
│   │   │   ├── tasks.py             # 任务 CRUD + 生命周期操作
│   │   │   ├── eval.py              # 评测执行 + SSE + 日志 + 报告
│   │   │   ├── results.py           # 结果查询 + 可视化数据
│   │   │   ├── catalog.py           # 数据集/模型/指标目录
│   │   │   ├── models.py            # 已管理模型 CRUD
│   │   │   └── settings.py          # 系统设置（内存存储）
│   │   ├── core/
│   │   │   ├── config.py            # Pydantic BaseSettings（环境变量配置）
│   │   │   └── database.py          # 同步数据库层（legacy）
│   │   ├── db/
│   │   │   ├── database.py          # SQLAlchemy async engine + get_db()
│   │   │   └── models.py            # ORM 模型定义
│   │   ├── schemas/                 # Pydantic 请求/响应 Schema
│   │   │   ├── task.py
│   │   │   ├── dataset.py
│   │   │   ├── model.py
│   │   │   ├── result.py
│   │   │   └── common.py
│   │   ├── services/                # 业务逻辑服务层
│   │   │   ├── eval_service.py
│   │   │   └── report_service.py
│   │   └── static/                  # 静态资源（Plotly 图表库等）
│   │       └── plotly.min.js        # 4.4MB，本地化供报告内嵌使用
│   └── evalscope_wrapper/
│       ├── runner.py                # 异步评测执行器（API 使用）
│       ├── executor.py              # 同步执行器（log tail，支持取消）
│       ├── registry.py              # EvalScope 注册表封装
│       └── catalog.py               # 目录服务
├── frontend/
│   ├── src/
│   │   ├── main.tsx                 # React 入口 + Router + AntD 配置
│   │   ├── App.tsx                  # 路由定义 + 目录预加载
│   │   ├── api/
│   │   │   ├── client.ts            # Axios 实例（baseURL=/api）
│   │   │   ├── tasks.ts             # 任务 API
│   │   │   ├── results.ts           # 结果 + 评测执行 API
│   │   │   ├── catalog.ts           # 目录 API
│   │   │   ├── models.ts            # 模型管理 API
│   │   │   └── settings.ts          # 设置 API
│   │   ├── stores/
│   │   │   └── index.ts             # Zustand: useTaskStore, useCatalogStore
│   │   ├── types/
│   │   │   └── index.ts             # TypeScript 接口定义
│   │   ├── pages/
│   │   │   ├── Dashboard/           # 首页统计
│   │   │   ├── TaskList/            # 任务列表
│   │   │   ├── TaskCreate/          # 4步创建向导
│   │   │   ├── TaskEdit/            # 4步编辑向导
│   │   │   ├── TaskDetail/          # 详情 + 实时进度 + 图表 + 日志 + 报告
│   │   │   │   └── EditTaskModal.tsx # 内嵌弹窗编辑
│   │   │   ├── Catalog/             # 数据集/模型/指标浏览
│   │   │   ├── Models/              # 已管理模型
│   │   │   └── Settings/            # 系统设置
│   │   └── components/
│   │       └── Layout/              # 侧边栏 + 头部布局组件
│   ├── package.json
│   └── vite.config.ts
└── docs/
    ├── README.md
    ├── architecture.md              # 本文件
    ├── api.md
    ├── frontend.md
    ├── guide.md
    └── development.md
```

## 数据库模型

详见 [api.md](./api.md#数据库模型)。

## 数据流

### 任务执行流程

```
1. 用户在前端点击「启动」
   → POST /api/tasks/{id}/start        更新 DB status=RUNNING
   → POST /api/eval/run/{id}           触发后台执行

2. FastAPI BackgroundTask: execute_evaluation_task()
   → evalApi.run() 返回后立即响应前端
   → 实际评测在后台异步执行

3. EvalScopeRunner.run_evaluation() 线程池中调用 evalscope.run_task()
   → 评测执行，10%/20%/40%/90%/100% 回调进度
   → 进度回调 → DB 更新 + SSE 广播

4. 评测完成
   → runner 返回 EvalResult(score, metrics)
   → execute_evaluation_task() 更新 DB:
     status=COMPLETED, results={score, metrics}, duration
   → SSE 广播 complete 事件

5. 前端 EventSource 收到 complete 事件
   → fetchTask() 刷新详情
   → 加载可视化图表 + HTML 报告
```

### 实时更新架构（SSE）

```
EvalScopeRunner._report_progress()
    │
    │ asyncio.create_task()
    ▼
_update_progress(task_id, progress, message)
    │
    ├── DB 更新: task.progress, task.current_step
    │
    └── SSEManager.broadcast("progress", {progress, current_step, status})
            │
            ▼
        asyncio.Queue.put(message)
            │
            ▼
    SSE endpoint: /api/eval/stream/{task_id}
    async generator → yield f"event: progress\ndata: {...}\n\n"
            │
            ▼
    EventSource (前端 TaskDetail)
    → 解析事件 → setCurrentTask({progress, current_step})
```

### 日志读取

`GET /api/eval/log/{task_id}` 同时读取两个来源：
1. **数据库** (`task.logs`) — 存储错误信息，通常较短
2. **文件系统** (`outputs/task_{id}/{timestamp}/logs/eval_log.log`) — 完整评测日志

文件系统日志优先（全量），DB 日志兜底（无文件时）。

## 配置管理

后端使用 Pydantic `BaseSettings`，支持环境变量覆盖：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_URL` | `sqlite+aiosqlite:///./evalscope.db` | 数据库连接 |
| `DEBUG` | `True` | 调试模式 |
| `HOST` | `0.0.0.0` | 服务监听地址 |
| `PORT` | `8000` | 服务端口 |
| `EVALSCOPE_OUTPUT_DIR` | `./outputs` | 评测输出目录 |
| `EVALSCOPE_DATASET_DIR` | `./data/datasets` | 数据集目录 |
| `CORS_ORIGINS` | `["*"]` | CORS 白名单 |
