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
│   ├── POST   /{id}/start          [已废弃] 仅改状态不执行
│   ├── POST   /{id}/stop           停止（取消子进程）
│   ├── POST   /{id}/pause          暂停
│   ├── POST   /{id}/resume         续测（设 use_cache）
│   ├── POST   /{id}/retry          重试（重置状态）
│   └── GET    /{id}/status         状态查询
│
├── /api/eval           — 旧版评测执行
│   ├── POST   /run/{id}            直接启动评测（无确认）
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
  interrupt_before=["run_eval"]
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

### 3.3 评测执行流程（旧版 eval 路径 — 仅恢复暂停任务时使用）

```
evalApi.run(taskId)
        │
        ▼
POST /api/eval/run/{id}
        │
        ▼
更新 DB: status=RUNNING
        │
        ▼
BackgroundTasks → EvalScopeRunner.run_evaluation()
        │
        ▼
子进程执行 evalscope
        │
        ├── 进度回调 → SSEManager.broadcast("progress")
        ├── 日志回调 → SSEManager.broadcast("logs")
        │
        ▼
完成 → SSEManager.broadcast("complete")
        │
        ▼
更新 DB: status=COMPLETED/FAILED
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
│  running    │  停止 / 删除                  │  暂停 / 停止 / 停止并删除    │
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

## 九、两套评测路径对比

```
                    旧版 eval API              新版 workflow API
                    ──────────────             ─────────────────
启动方式            POST /eval/run/{id}        POST /workflow/{id}/start
人工确认            无                         interrupt_before run_eval
错误诊断            无                         diagnose_error 自动分类
自动重试            无                         should_retry 条件路由
状态持久化          仅 DB                      DB + LangGraph Checkpoint
SSE 实时进度        有（SSEManager）           无（直接写 DB）
执行方式            EvalScopeRunner             multiprocessing.Process
前端使用场景        TaskDetail handleResume     启动/重试/确认/取消
```

## 十、已知架构问题

1. **SSE 与 Workflow 脱节**：workflow 路径的 run_eval 不调用 SSEManager，前端无法实时获取进度，只能 3 秒轮询
2. **数据库访问不一致**：workflow 节点用同步 sqlite3，API 层用 SQLAlchemy AsyncSession
3. **handleResume 不一致**：TaskDetail 走 evalApi.run，TaskList 走 workflowApi.start
4. **轮询开销**：confirming 状态持续 3 秒轮询，列表页对 pending 任务批量查询
