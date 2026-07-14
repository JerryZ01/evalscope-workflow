# EvalScope Workflow 功能逻辑架构

## 一、系统总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端 (React + Vite)                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────┐ │
│  │TaskCreate│ │TaskList  │ │TaskDetail│ │Dashboard │ │ Chat │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └──┬───┘ │
│       │            │            │              │           │     │
│  ┌────┴────────────┴────────────┴──────────────┴───────────┴──┐ │
│  │                    API 层 (Axios)                            │ │
│  │  taskApi │ evalApi │ workflowApi │ resultsApi │ catalogApi │ │
│  └────┬────────────┬────────────┬──────────┬──────────┬───────┘ │
└───────┼────────────┼────────────┼──────────┼──────────┼─────────┘
        │            │            │          │          │
┌───────┼────────────┼────────────┼──────────┼──────────┼─────────┐
│       │   后端 (FastAPI + LangGraph)       │          │         │
│  ┌────┴────┐ ┌────┴────┐ ┌────┴─────┐ ┌──┴───┐ ┌───┴───┐     │
│  │/api/    │ │/api/    │ │/api/     │ │/api/ │ │/api/  │     │
│  │tasks    │ │eval     │ │workflow  │ │results│ │catalog│     │
│  └────┬────┘ └────┬────┘ └────┬─────┘ └──┬───┘ └───┬───┘     │
│       │           │           │           │         │          │
│  ┌────┴───────────┴───────────┴───────────┴─────────┴───┐     │
│  │              SQLAlchemy AsyncSession                   │     │
│  └───────────────────────┬───────────────────────────────┘     │
│                          │                                      │
│  ┌───────────────────────┴───────────────────────────────┐     │
│  │              SQLite 数据库 (evalscope.db)              │     │
│  └───────────────────────────────────────────────────────┘     │
│                                                                │
│  ┌───────────────────────────────────────────────────────┐     │
│  │         LangGraph Checkpoint (evalscope_checkpoints.db)│     │
│  └───────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────┘
```

## 二、后端路由与 API 端点

```
FastAPI App
├── /api/tasks          — 任务 CRUD
│   ├── GET    /                    列表（分页/搜索）
│   ├── POST   /                    创建
│   ├── GET    /{id}                详情
│   ├── PATCH  /{id}                更新
│   ├── DELETE /{id}                删除
│   ├── POST   /{id}/start          [已废弃] 委托统一工作流
│   ├── POST   /{id}/stop           停止（取消子进程）
│   ├── POST   /{id}/resume         续测（设 use_cache）
│   ├── POST   /{id}/retry          重试（重置状态）
│   └── GET    /{id}/status         状态查询
│
├── /api/eval           — 实时事件与兼容入口
│   ├── POST   /run/{id}            [已废弃] 委托统一工作流
│   ├── GET    /stream/{id}         SSE 实时进度推送
│   ├── GET    /log/{id}            日志查询
│   └── GET    /report/{id}         报告查询
│
├── /api/workflow       — 新版工作流
│   ├── POST   /{id}/start          启动工作流（到 interrupt 暂停）
│   ├── GET    /{id}/status         查询工作流状态
│   ├── POST   /{id}/confirm        确认继续执行
│   └── POST   /{id}/cancel         取消工作流
│
├── /api/results        — 结果查询
├── /api/catalog        — 数据集/模型/指标目录
├── /api/models         — 模型管理
└── /api/chat           — AI 助手（LangGraph ReAct Agent）
```

## 三、核心业务流程图

### 3.1 任务创建流程

```
用户填写表单（模型/数据集/参数）
        │
        ▼
前端 taskApi.create(params)
        │
        ▼
POST /api/tasks
        │
        ▼
查找 ManagedModel 补全配置
        │
        ▼
创建 EvaluationTask (status=PENDING)
        │
        ▼
返回任务详情 → 前端跳转任务列表
```

### 3.2 评测执行流程（工作流路径 — 当前默认）

```
用户点"启动"
        │
        ▼
前端 workflowApi.start(taskId)
        │
        ▼
POST /api/workflow/{id}/start
        │
        ▼
构建 EvalState 初始状态
        │
        ▼
graph.ainvoke(initial_state)
 ┌──────┴──────┐
 │ prepare_config │ → 判断沙箱/judge需求，生成config_summary
 └──────┬──────┘
        │
 ┌──────┴──────┐
 │validate_params│ → 校验 API Key/URL
 └──────┬──────┘
        │
        ▼
  interrupt_before=["await_confirmation"]
  工作流暂停，等待人工确认
        │
        ▼
返回 {status: "started"} → 前端
        │
        ▼
前端查询 workflowApi.getStatus()
发现 waiting_for_confirmation=true
        │
        ▼
effectiveStatus = "confirming"
显示配置摘要卡片 + "确认执行"/"取消" 按钮
        │
        ├── 用户点"取消" ──→ POST /workflow/{id}/cancel → DB status=CANCELLED → END
        │
        ▼ 用户点"确认执行"
前端 workflowApi.confirm(taskId)
        │
        ▼
POST /api/workflow/{id}/confirm
        │
        ▼
asyncio.create_task(graph.ainvoke(Command(resume=True)))
后台执行，立即返回 {status: "confirmed"}
        │
        ▼
 ┌──────┴──────┐
 │   run_eval   │ → 子进程执行 evalscope.run_task()
 └──────┬──────┘
        │
   ┌────┴────┐
   │ 成功？  │
   └────┬────┘
    Yes │     │ No
        │     │
        ▼     ▼
 ┌──────────┐  ┌──────────────┐
 │collect_  │  │diagnose_error│ → 分类错误（密钥过期/不可达/超限等）
 │results   │  └──────┬───────┘
 └────┬─────┘         │
      │          ┌────┴────┐
      │          │should_  │
      │          │retry    │
      │          └────┬────┘
      │         Yes/  │  \No
      │          │    │   │
      │          ▼    │   ▼
      │   ┌──────────┐│ ┌──────────┐
      │   │increment_││ │mark_     │
      │   │retry     ││ │failed    │
      │   └────┬─────┘│ └────┬─────┘
      │        │      │      │
      │        ▼      │      ▼
      │   run_eval    │   DB status=FAILED
      │   (重试循环)  │      │
      │               │      ▼
      ▼               ▼     END
 DB status=COMPLETED
      │
      ▼
  前端 fetchTask() 刷新结果
```

### 3.3 旧版入口兼容

```
POST /api/eval/run/{id}
        │
        ▼
start_workflow(taskId)
        │
        ▼
与 /api/workflow/{id}/start 完全相同，等待人工确认
```

### 3.4 停止/重试/续测流程

```
停止运行中任务:
  stopTask() → POST /api/tasks/{id}/stop
    → cancel_runner() 取消子进程
    → DB status=CANCELLED
    → SSE broadcast("complete", {status:"cancelled"})

重试任务:
  retryTask() → POST /api/tasks/{id}/retry
    → DB status=PENDING, progress=0, 清除时间戳
  → workflowApi.start() → (走工作流启动流程)

续测任务:
  taskApi.resume() → POST /api/tasks/{id}/resume
    → DB use_cache=output_dir, status=PENDING
  → workflowApi.start() → (走工作流启动流程，复用旧输出目录)
```

## 四、前端 effectiveStatus 判断逻辑

```
DB task.status          workflowStatus.waiting_for_confirmation
    │                              │
    ├── "pending" ──┬── true  ──→ effectiveStatus = "confirming"
    │               └── false ──→ effectiveStatus = "pending"
    │
    ├── "running"    ──────────→ effectiveStatus = "running"
    ├── "completed"  ──────────→ effectiveStatus = "completed"
    ├── "failed"     ──────────→ effectiveStatus = "failed"
    └── "cancelled"  ──────────→ effectiveStatus = "cancelled"
```

**confirming 状态的来源**：
- TaskDetail：页面加载时对 pending 任务调用 `workflowApi.getStatus()`，若 `waiting_for_confirmation=true` 则启动 3 秒轮询
- TaskList：列表加载后对 pending 任务批量调用 `workflowApi.getStatus()`，结果缓存到 `workflowStatusMap`

## 五、前端 UI 状态与操作映射

```
┌─────────────┬──────────────────────────────┬──────────────────────────────┐
│effectiveStatus│       TaskList 操作          │       TaskDetail 操作        │
├─────────────┼──────────────────────────────┼──────────────────────────────┤
│  pending    │  启动                         │  启动 / 编辑参数 / 删除       │
│  confirming │  确认 / 取消                  │  确认执行 / 取消 / 修改参数   │
│  running    │  停止 / 删除                  │  停止 / 停止并删除           │
│  completed  │  重试 / 删除                  │  删除                        │
│  failed     │  续测 / 重试 / 删除           │  重试 / 编辑参数 / 删除       │
│  cancelled  │  续测 / 重试 / 删除           │  重试 / 编辑参数 / 删除       │
└─────────────┴──────────────────────────────┴──────────────────────────────┘
```

**confirming 状态额外 UI**：
- TaskDetail：黄色配置摘要卡片（模型/数据集/引擎/沙箱/judge/样本限制）
- TaskDetail：failed 状态显示诊断结果 Alert

## 六、SSE 实时进度推送

```
后端 SSEManager                    前端 TaskDetail
┌─────────────────┐               ┌─────────────────┐
│ _connections:   │               │ EventSource     │
│   task_id →     │   SSE 帧      │  /api/eval/     │
│   Set[Queue]    │ ──────────→   │  stream/{id}    │
└─────────────────┘               └────────┬────────┘
                                            │
                                   ┌────────┴────────┐
                                   │ 事件处理         │
                                   ├─────────────────┤
                                   │ progress → 更新 │
                                   │   progress/     │
                                   │   current_step  │
                                   │ logs → 追加日志  │
                                   │ complete →      │
                                   │   fetchTask()   │
                                   │ heartbeat → 忽略│
                                   └─────────────────┘
```

**SSE 连接条件**：仅 `effectiveStatus === 'running'` 时建立
**断线重连**：5 秒后自动重连（仅 running 状态）

## 七、AI 助手（LangGraph ReAct Agent）

```
POST /api/chat/
        │
        ▼
查找 ManagedModel → 构建 ChatOpenAI
        │
        ▼
构建 6 个 StructuredTool:
  ├── query_tasks          — 查询任务列表
  ├── get_task_detail      — 获取任务详情
  ├── compare_models       — 模型对比
  ├── list_datasets        — 列出数据集
  ├── list_managed_models  — 列出已管理模型
  └── get_dashboard_summary— 仪表盘摘要
        │
        ▼
create_react_agent(model, tools, prompt)
        │
        ▼
agent.astream_events() → 流式输出
  ├── on_chat_model_stream → 输出 content
  ├── on_tool_start → 输出 "正在查询..."
  └── done → 输出 usage + trace_url
```

## 八、数据存储架构

```
┌─────────────────────────────────────────┐
│           evalscope.db (SQLite)          │
│  ┌─────────────────┐  ┌──────────────┐  │
│  │ evaluation_tasks │  │ managed_     │  │
│  │ ─────────────── │  │ models       │  │
│  │ id              │  │ ──────────── │  │
│  │ task_uuid       │  │ id           │  │
│  │ name            │  │ name         │  │
│  │ model_name      │  │ model_name   │  │
│  │ status (枚举)   │  │ api_url      │  │
│  │ progress        │  │ api_key      │  │
│  │ current_step    │  │ generation_  │  │
│  │ results (JSON)  │  │ config       │  │
│  │ logs            │  └──────────────┘  │
│  │ output_dir      │                    │
│  │ error           │  ┌──────────────┐  │
│  └─────────────────┘  │ users        │  │
│                        │ datasets     │  │
│                        │ model_types  │  │
│                        │ metrics      │  │
│                        └──────────────┘  │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│   evalscope_checkpoints.db (SQLite)     │
│  LangGraph AsyncSqliteSaver 持久化      │
│  ┌──────────────┐  ┌─────────────────┐  │
│  │ checkpoints  │  │ writes          │  │
│  │ ──────────── │  │ ─────────────── │  │
│  │ thread_id    │  │ thread_id       │  │
│  │ checkpoint_id│  │ checkpoint_id   │  │
│  │ checkpoint   │  │ task_id         │  │
│  │ metadata     │  │ channel         │  │
│  └──────────────┘  │ value           │  │
│                     └─────────────────┘  │
└─────────────────────────────────────────┘
```

## 九、统一执行与数据访问

所有启动入口最终进入 `/api/workflow`。业务状态通过 `app.services.task_state`
和 SQLAlchemy 写入 `DATABASE_URL`；评测子进程不直接访问数据库，只通过队列返回结果和日志。
工作流 checkpoint 使用 `WORKFLOW_CHECKPOINT_DB`，不保存 API Key。升级到安全 schema v2
时会清理旧 checkpoint，避免历史明文密钥残留。

## 十、已知架构问题

1. **单机执行模型**：后台协程、子进程注册表和 SSE 连接都在进程内，不支持多 worker 横向扩展
2. **at-least-once 语义**：服务在长时间 `run_eval` 中崩溃后，需要依赖 EvalScope cache 续测
3. **轮询开销**：confirming 状态持续 3 秒轮询，列表页对 pending 任务批量查询
