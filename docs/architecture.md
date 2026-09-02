# EvalScope Workflow 功能逻辑架构

> 本文档的每一张架构图都配有详细文字说明，覆盖：**图里每个元素是什么、数据如何流转、为什么这么设计、以及边界和坑**。
> 标注 ⚠️ 处是与代码核对后发现的、需要特别注意的细节。

---

## 一、系统总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端 (React + Vite)                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────┐ │
│  │TaskCreate│ │TaskList  │ │TaskDetail│ │Dashboard │ │ Chat │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └──┬───┘ │
│       │            │            │              │           │     │
│  ┌────┴────────────┴────────────┴──────────────┴───────────┴──┐ │
│  │                    API 层 (Axios + EventSource)             │ │
│  │  taskApi │ workflowApi │ resultsApi │ catalogApi │ models  │ │
│  │  chatApi │ settingsApi │ authApi    │ (SSE 直连)           │ │
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
└──────────────────────────────┬──────────────────────────────────┘
                               │  run_eval 节点起子进程
                               │  （multiprocessing.Process）
                               ▼
        ┌──────────────────────────────────────────┐
        │     评测执行引擎 (EvalScope，独立子进程)    │
        │   run_task(config) → 模型推理 → 判分 → 报告 │
        │   └── 通过 OpenAI 兼容 API 调被测模型       │
        └──────────────────────────────────────────┘
```

**详细说明**

**整体定位**：这是一个**单机、前后端分离**的 Web 应用。前端负责交互和展示，后端负责业务逻辑和评测编排，数据落在两个 SQLite 文件里。没有消息队列、没有 Redis、没有独立 Worker——所有东西都跑在一个后端进程里（这个"单机"是理解后面很多设计取舍的关键前提）。

**前端层（React + Vite）**：

图中只画了 5 个核心页面，⚠️ 实际上 `frontend/src/pages/` 下有 **11 个页面目录**，完整清单是：

| 页面 | 作用 | 是否在总览图里 |
|---|---|---|
| `TaskCreate` | 创建评测任务 | ✅ 画了 |
| `TaskList` | 任务列表 | ✅ 画了 |
| `TaskDetail` | 任务详情 + 结果展示 | ✅ 画了 |
| `Dashboard` | 仪表盘 | ✅ 画了 |
| `AIChat` | AI 助手 | ✅ 画了（图里叫 Chat） |
| `TaskEdit` | 编辑任务参数 | ❌ 未画 |
| `Catalog` | 数据集/指标目录浏览 | ❌ 未画 |
| `Models` | 模型管理 | ❌ 未画 |
| `Settings` | 系统设置 | ❌ 未画 |
| `Docs` | 文档页 | ❌ 未画 |
| `EvalPlatformV1` | 内嵌旧评测平台的 iframe | ❌ 未画 |

总览图刻意只保留 5 个高频页面，是为了突出"任务"这条主线；其余 6 个是辅助页面，不影响理解核心链路。

**API 层（前端数据访问）**：

⚠️ 这里有个容易搞错的地方。`frontend/src/api/` 下有 9 个文件，但**没有独立的 `evalApi` 文件**：

- `tasks.ts` → 任务 CRUD + 动作
- `workflow.ts` → 工作流（start/status/confirm/cancel）
- `results.ts` → **结果 + 评测日志/报告读取**（`/eval/log`、`/eval/report` 都封装在这里，而不是独立的 evalApi）
- `catalog.ts` → 目录
- `models.ts` → 模型管理
- `chat.ts` → AI 助手
- `settings.ts` → 系统设置
- `auth.ts` → 认证
- `client.ts` → 共享的 axios 实例（拦截器、baseURL、鉴权头）

**SSE 不走 axios**：实时进度推送用浏览器原生 `EventSource` 直接连后端 `/api/eval/stream/{id}`，因为 axios 默认不支持 SSE 流式读取。这是"API 层"里唯一绕过 axios 的通道。

**后端层（FastAPI）**：

按资源拆成多个 router，统一前缀 `/api/`。图中画了 5 个，⚠️ 实际 `main.py` 还注册了 `/api/settings` 和 `/api/auth`，共 **9 个 router**（完整清单见第二章）。

**评测执行引擎（EvalScope，独立子进程）**：

⚠️ 这是第一版总览图遗漏的一层，但它其实是**真正"干活"的引擎**：

- 图中后端层下方那个独立的框，是 **EvalScope 评测引擎**，运行在**独立的子进程**里（不是后端进程的一部分）。
- 它由 LangGraph 工作流的 `run_eval` 节点通过 `multiprocessing.Process` 启动，执行 `evalscope.run_task(config)`——真正发请求调被测模型、跑推理、算分、生成报告。
- **为什么它要独立画一层，而不是并进后端框里**：因为它和后端是**进程隔离**的。评测是同步、长耗时、可能崩溃的（跑几十分钟甚至更久），必须放到独立子进程，否则会阻塞 FastAPI 的事件循环，也无法用 SIGTERM/SIGKILL 停止。

**这层的关系一句话**：FastAPI 负责"接请求、管业务"，LangGraph 负责"编排流程"，**EvalScope 负责"真正执行评测"**——三者各司其职，EvalScope 是唯一真正调用模型、产生评测结果的引擎。

**数据访问**：所有 router 共享同一个 SQLAlchemy `AsyncSession`（异步会话），落库统一走 `app.services.task_state` 这一层（而不是每个接口自己写 SQL）。这个集中式的状态写入层，是后面"业务状态一致性"的关键。

**两个 SQLite 库，物理分离**：

| 库 | 文件 | 存什么 | 谁写 |
|---|---|---|---|
| 业务库 | `evalscope.db` | 任务、模型、数据集、指标、用户 | FastAPI（经 SQLAlchemy） |
| checkpoint 库 | `evalscope_checkpoints.db` | LangGraph 工作流状态 | LangGraph `AsyncSqliteSaver` |

**为什么必须分两个库**：① checkpoint 不存 API Key（只存 `has_model_key` 布尔值），分库后可以**单独清空 checkpoint 库**而不影响业务数据；② schema 升级（比如安全 schema v2 要清掉旧 checkpoint 避免残留明文密钥）时，直接删 checkpoint 库即可，业务库不动。这是刻意的安全隔离设计。

---

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
│   ├── GET /tasks/{id}/results           原始结果
│   ├── GET /tasks/{id}/visualization     图表数据（雷达图/柱状图）
│   ├── GET /models/{name}/trend          单模型历史趋势
│   └── GET /compare                      多模型对比
│
├── /api/catalog        — 数据集/模型类型/指标/引擎目录
│   ├── GET /datasets、/datasets/{name}
│   ├── GET /models、/models/{name}       （模型类型，非 ManagedModel）
│   ├── GET /metrics
│   └── GET /engines、/engines/{name}
│
├── /api/models         — 模型管理（ManagedModel）
│   ├── GET  /、/brief、/default、/{id}
│   ├── POST /、/{id}/set-default、/{id}/test、/{id}/use
│
├── /api/chat           — AI 助手（LangGraph ReAct Agent）
├── /api/settings       — 系统设置          ⚠️ 早期文档遗漏
└── /api/auth           — 认证（可选令牌）  ⚠️ 早期文档遗漏
```

**详细说明**

后端路由可以分成四组，各自职责清晰：

**第一组：任务管理（`/api/tasks`）**

标准 CRUD + 4 个动作端点。要点：

- `POST /{id}/start` 标记为 `deprecated`——它内部只是转调 `start_workflow`，走的是新版工作流路径。保留它是为了兼容旧前端代码，新前端应该直接用 `/api/workflow/{id}/start`。
- `stop` / `resume` / `retry` 是三个不同的动作，**不要混淆**：
  - `stop`：终止正在运行的评测（杀子进程）
  - `resume`：续测——对失败/取消的任务，设 `use_cache=output_dir` 后重新启动，复用已完成样本
  - `retry`：重试——重置状态从头再来，不复用缓存

**第二组：评测执行（`/api/eval` + `/api/workflow`）**

- `/api/eval/run/{id}` 已废弃，和 tasks 的 start 一样转调工作流。
- `/api/eval/stream/{id}` 是 SSE 端点，唯一走 EventSource 的通道（见第六章）。
- `/api/eval/log/{id}` 和 `/api/eval/report/{id}` 实际被 `results.ts` 封装调用，是"读日志/报告"的通道。
- `/api/workflow` 是**新的统一入口**：start（启动到确认点）、status（查状态）、confirm（确认继续）、cancel（取消）。所有"启动评测"的入口最终都汇聚到这里。

**第三组：结果与目录（`/api/results` + `/api/catalog`）**

- `/api/results` 有 4 个端点，其中 `trend`（单模型趋势）和 `compare`（多模型对比）⚠️ **后端实现了、前端 API 也封装了，但没有页面调用**——历史版本对比的可视化页面没有做，唯一实际可用的对比入口是 AI 助手的 `compare_models` 工具。
- `/api/catalog` 提供数据集、模型类型、指标、引擎四类**目录**信息，数据来源是 EvalScope 的注册表（见 `evalscope_wrapper/catalog.py` 和 `registry.py`）。

**第四组：辅助（`/api/models` + `/api/chat` + `/api/settings` + `/api/auth`）**

- `/api/models` 管理 `ManagedModel`（已纳管的模型，含 api_url/api_key），有 `set-default`、`test`（连通性测试）、`use`（标记使用）等端点。
- `/api/chat` 是 AI 助手（第七章）。
- `/api/settings`、`/api/auth` ⚠️ 早期文档遗漏了这两个。

---

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

**详细说明**

这一步的核心是**"只落库、不执行"**——创建任务和运行任务是彻底解耦的两步。

**数据流转**：

1. 用户在 TaskCreate 页填表单：模型名、数据集列表、引擎、样本限制、生成参数（前端只传 `{stream}` 这类少量参数）。
2. 前端调 `taskApi.create(params)` → `POST /api/tasks`。
3. 后端收到请求后，**按 `model_name` 去 `ManagedModel` 表查完整配置**——主要是 `api_url`、`api_key`、`generation_config`（temperature/max_tokens 等存在模型配置里）。
4. **配置合并**：以模型配置为底、任务级参数覆盖。这就是为什么"同一个模型在多个任务里生成参数一致"——因为参数集中在模型管理页维护，任务只覆盖差异部分。
5. 落库 `EvaluationTask`，初始 `status=PENDING`，`progress=0`。
6. 返回任务详情，前端跳转到任务列表。

**为什么这么设计**：创建时不碰模型、不校验连通性、不跑任何评测，所以接口是纯 DB 操作，毫秒级返回。真正的"花钱"动作被推迟到"启动 → 确认"之后（见 3.2），这是成本控制的第一道闸。

**一个边界**：创建时不校验 `api_key` 是否有效、模型端点是否可达——这些留到 `validate_params` 节点做（见 3.2），所以一个"配置错误的任务"可以成功创建，但要到启动阶段才会报错。

---

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
 └──┬─────┬────┘
    │     └── 校验失败 ──→ diagnose_error（跳过人工确认，直接失败）
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
 └──┬─────┬────┘
     │     └── 失败(eval_success=False) ──→ diagnose_error
     │
     ▼ 成功(eval_success=True)
 ┌──────────┐
 │collect_  │
 │results   │
 └────┬─────┘
      │
      ▼
 DB status=COMPLETED
      │
      ▼
  前端 fetchTask() 刷新结果

（失败路径，从 diagnose_error 起）
 ┌──────────────┐
 │diagnose_error│ → 分类错误（密钥过期/不可达/超限等）
 └──────┬───────┘
        │
   ┌────┴────┐
   │should_  │  ← 条件路由函数（不是节点），返回 "retry" 或 "stop"
   │retry    │
   └────┬────┘
   retry│     │stop
        │     │
        ▼     ▼
 ┌──────────┐ ┌──────────┐
 │increment_│ │mark_     │
 │retry     │ │failed    │
 │retry+1,  │ └────┬─────┘
 │use_cache=│      │
 │旧work_dir│      ▼
 └────┬─────┘  DB status=FAILED
      │           │
      ▼           ▼
   回到 run_eval  END
   (重试循环)
```

**详细说明**

这是全系统的核心流程，值得逐段拆开。

**阶段一：启动（start）—— 同步跑到确认点**

`POST /api/workflow/{id}/start` 内部：

1. 先删掉同 `thread_id` 的旧 checkpoint（防止上一次运行的脏状态污染）。
2. 构建 `EvalState` 初始状态——注意这里**只放 `has_model_key: bool`，不放 `api_key` 本身**（密钥安全，见第九章）。
3. `graph.ainvoke(initial_state)` **同步执行**，跑 `prepare_config → validate_params` 两个节点。
4. 撞上 `interrupt_before=["await_confirmation"]` 后，图主动 return（不是抛异常、不是阻塞）。

⚠️ **关键认知**：`start` 接口"快"不是因为异步，而是因为前两个节点是纯 CPU 的轻量逻辑——`prepare_config` 只是判断哪些数据集需要沙箱/Judge、拼配置摘要字符串；`validate_params` 只是校验 key/url 字段是否齐全。**真正耗时的评测还没开始**，要等确认。

**阶段二：人工确认（confirming）**

- `start` 返回 `{status: "started"}`，但响应体里**不含配置摘要**。前端要再调 `GET /api/workflow/{id}/status`，从 `state.next` 非空判断出"停在确认点"，拿到 `config_summary` 和 `waiting_for_confirmation=true`。
- 前端派生出 `effectiveStatus = "confirming"`（见第四章），显示黄色配置摘要卡片 + "确认执行/取消"按钮。
- ⚠️ `confirming` 态**走 3 秒轮询，不走 SSE**（SSE 只在 running 时建立）。

**为什么要有确认门禁**：评测会烧 API Token、可能启动 Docker 沙箱、可能调 LLM Judge，是有真实成本的动作。确认点让用户在花钱前看清楚"我要评什么、什么模型、什么数据集、要不要沙箱"。

**为什么确认点要放在工作流里，而不是前端弹窗**：前端弹窗无法证明"任务真的处于可确认状态"，刷新页面就丢了，还能绕过。把确认点做成 `interrupt_before`，它就成了**写在 checkpoint 里的服务端事实**——刷新、换设备都能查到，也绕不过去。

**阶段三：确认（confirm）—— 真正异步的起点**

`POST /api/workflow/{id}/confirm` 内部：

1. 校验图确实停在 `await_confirmation`（防止乱序调用）。
2. 幂等检查：已有未完成的后台任务就返回 409（防重复点确认）。
3. DB 置 `running`。
4. `asyncio.create_task(graph.ainvoke(Command(resume=True)))`，把续跑挂到后台，**立即返回 202**。

⚠️ 这里用的是 `asyncio.create_task`，**不是 FastAPI 的 `BackgroundTasks`**（虽然代码里 import 了后者但没实际用）。用 `create_task` 是因为它返回的 Task 可以 `.cancel()`（供取消用）、需要保持强引用（供注册表防 GC）。

**阶段四：run_eval —— 真正执行评测**

`run_eval` 节点做四件事：

1. **JIT 取密钥**：从业务库现查 `model_url`/`model_key`（不经过 checkpoint）。
2. 就地拼 EvalScope 的 `TaskConfig`（`eval_type=openai_api`、`api_url`、`api_key`、`datasets` 整列表、`work_dir`、`use_cache` 等）。
3. 清 `ModelCache._models`（防复用上次的 base_url）。
4. 起 `multiprocessing.Process` 子进程，子进程里 `run_task(config)`。

⚠️ 关于子进程的更多细节（为什么用子进程不用线程、三条父子通信通道、实时日志为什么走文件），见《评测链路深度拆解》文档，这里不展开。

**阶段五：结果处理（成功/失败分流）**

- **成功** → `collect_results` 解析 Report、落库 `COMPLETED`、SSE 推 `complete`。
- **失败** → `diagnose_error` 用**关键词匹配**给错误分类（密钥过期/不可达/超限/沙箱资源不足等），然后 `should_retry` 判断：
  - 临时性错误（网络超时、429 限流）且 `retry_count < 上限` → `increment_retry`（`retry_count+1`，`use_cache` 指向上次 work_dir）→ 回到 `run_eval` 重跑。
  - 不可重试（配置错、数据集不存在）或超上限 → `mark_failed` → DB `FAILED`。

⚠️ 重试上限是 **1 次**（保守策略，避免模型接口故障时形成重试风暴和额外费用）。错误分类是"关键词匹配"的 Phase 1 方案，脆弱但低成本、可解释。

---

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

**详细说明**

`/api/eval/run/{id}` 和 `/api/tasks/{id}/start` 都是**历史遗留入口**，内部只是转调 `start_workflow`，最终走的是同一条工作流路径（3.2）。

**为什么保留**：前端老版本可能还在调这两个旧入口，直接删会破坏兼容。它们现在标记 `deprecated`，新代码统一走 `/api/workflow`。这是"向后兼容"的典型做法——不删旧接口，而是让它委托到新实现。

**对面试的意义**：如果你被问"为什么有新旧两套入口"，答"历史迭代的兼容层，旧的委托到新的，没有两套并行逻辑"，比答"我不知道"好得多。同理，`executor.py`、`cancel_runner` 这些死代码，也是迭代遗留的产物（见《评测链路深度拆解》）。

---

### 3.4 停止/重试/续测流程

```
停止运行中任务:
  stopTask() → POST /api/tasks/{id}/stop
    → cancel_runner()      ⚠️ 死代码，查不到 runner 只打 warning
    → cancel_eval_process()  ← 真正生效：SIGTERM → 5s → SIGKILL
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

**详细说明**

三个动作**语义完全不同**，面试被问时务必分清：

**停止（stop）—— 终止正在运行的评测**

- 只对 `running` 状态有效（否则返回 400）。
- ⚠️ 代码同时调了 `cancel_runner` 和 `cancel_eval_process` 两个函数，但**只有 `cancel_eval_process` 真正生效**：
  - `cancel_runner` 查的 `_runner_registry` 在工作流路径下**从不被填充**，只会打一行 "未找到 runner 实例" 的 warning——这是死代码。
  - `cancel_eval_process` 从 `_eval_processes` 注册表拿出子进程句柄，走降级链：`os.kill(pid, SIGTERM)` → `join(timeout=5)` → 仍活着则 `process.kill()`（SIGKILL）。
- 杀完子进程后 DB 置 `CANCELLED`，并 SSE 广播 `complete` 事件（`status: cancelled`），让前端即时感知。
- ⚠️ 已知 bug：`stop` **不取消** `confirm` 起的后台 asyncio 任务，导致子进程死后可能被 `mark_failed` 覆写状态（详见《评测链路深度拆解》的 bug 1）。

**重试（retry）—— 从头再来，不复用缓存**

- 把任务重置回 `PENDING`、`progress=0`、清空时间戳，然后重新走 `start` 流程。
- 和"续测"的区别：重试**不设 `use_cache`**，从头跑；续测设 `use_cache`，复用已完成样本。

**续测（resume）—— 复用已完成样本接着跑**

- 核心一行：`use_cache = output_dir`，即把上次的输出目录作为 EvalScope 的续评依据。
- 然后重新走 `start` 流程，`run_eval` 时 EvalScope 读缓存、跳过已完成样本、从断点接着评。
- ⚠️ 续评是**样本级（条级）**的，不是数据集级——EvalScope 的 `use_cache` 语义是 "skip completed samples"，每样本完成即 flush 落盘（详见《评测链路深度拆解》§10 和 EvalScope 源码）。

---

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

**详细说明**

这是前端一个关键的**状态派生逻辑**，体现了"业务状态"和"工作流状态"是两套体系。

**为什么需要 effectiveStatus 这个中间概念**：

- DB 的 `task.status` 只有 5 个枚举值（pending/running/completed/failed/cancelled），它是**业务事实**——"这个任务现在是什么状态"。
- LangGraph 工作流多了一个 DB 里没有的中间态——"停在确认点等人确认"。这个状态存在于 checkpoint 里（`state.next` 非空），不在 DB 里。
- 于是前端需要把两者**合并派生**出第 6 个 UI 状态 `confirming`：当 DB 是 `pending` 且工作流 `waiting_for_confirmation === true` 时，UI 上显示"确认执行/取消"按钮。

**三层状态的关系**（贯穿全系统）：

| 层 | 是什么 | 回答什么问题 |
|---|---|---|
| DB `task.status` | 业务事实 | "任务现在什么状态" |
| LangGraph checkpoint | 流程位置 | "工作流走到哪、停在哪" |
| `effectiveStatus` | UI 派生态 | "界面上该显示什么按钮" |

**confirming 态怎么被发现的**：

- **TaskDetail**：页面加载时，对 `pending` 任务调 `workflowApi.getStatus()`；若发现 `waiting_for_confirmation=true`，就启动 **3 秒轮询**（因为这个态不走 SSE）。
- **TaskList**：列表加载后，对 pending 任务**批量**调 `getStatus()`，结果缓存到 `workflowStatusMap`（一个 task_id → 工作流状态的映射），避免每条都单独请求。

⚠️ **两个边界**：

1. `confirming` 态**没有用 SSE**，而是轮询——因为 SSE 只在 `running` 时才建立连接，而 confirming 时任务还没 running。
2. 列表页批量查询 + 3 秒轮询，任务多时有**请求放大**问题，这是已知的优化点（见第十章）。

---

## 五、前端 UI 状态与操作映射

```
┌─────────────┬──────────────────────────────┬──────────────────────────────┐
│effectiveStatus│       TaskList 操作          │       TaskDetail 操作        │
├─────────────┼──────────────────────────────┼──────────────────────────────┤
│  pending    │  启动                         │  启动 / 编辑参数 / 删除       │
│  confirming │  确认 / 取消                  │  确认执行 / 取消             │
│  running    │  停止                         │  停止 / 停止并删除           │
│  completed  │  重试                         │  删除                        │
│  failed     │  续测 / 重试                  │  重试 / 编辑参数             │
│  cancelled  │  续测 / 重试                  │  重试 / 编辑参数             │
└─────────────┴──────────────────────────────┴──────────────────────────────┘
```

> ⚠️ 说明：上表里"删除"入口在前端是通过 `effectiveStatus !== 'running' && effectiveStatus !== 'confirming'` 这个条件统一控制的——即**非运行中、非确认中的任务，列表页和详情页都有删除**。上面为保持表格简洁，只标注了各状态最核心的操作；完整删除逻辑见 `TaskList/index.tsx` 和 `TaskDetail/index.tsx`。

**confirming 状态额外 UI**：
- TaskDetail：黄色配置摘要卡片（模型/数据集/引擎/沙箱/judge/样本限制）
- TaskDetail：failed 状态显示诊断结果 Alert

**详细说明**

这张表是前端"什么状态该显示什么按钮"的**唯一权威依据**，完全由 `effectiveStatus` 驱动。读这张表能看出几个设计意图：

**1. 列表页和详情页的操作权限不同**

- 列表页偏**批量快捷操作**：启动、停止、重试、续测、删除——都是"一眼就能决定"的动作。
- 详情页多了**「编辑参数」「修改参数」**——因为详情页能看到完整配置，改参数需要看清上下文。列表页没有编辑入口，是为了防止在不看配置的情况下乱改。

**2. 每个状态可做的操作，反映了状态机的"可转移性"**

- `pending` → 启动（还没开始，谈不上别的）
- `confirming` → 确认或取消（卡在人工门禁，二选一）
- `running` → 只能停止（正在跑，不能改参数不能删，只能中断）
- `completed` → 重试（跑完了，重试=再来一次）
- `failed` / `cancelled` → 续测 / 重试（终态但可恢复：续测=复用缓存接着跑，重试=从头来）

⚠️ 删除入口是统一控制的：前端用 `effectiveStatus !== 'running' && effectiveStatus !== 'confirming'` 判断，即**非运行中、非确认中的任务都可以删除**（列表页和详情页都如此）。所以删除没有列在上表每个状态里，而是作为"除 running/confirming 外都可用"的通用操作。

**3. 两个特殊状态的额外 UI**

- `confirming`：黄色配置摘要卡片，内容来自 `prepare_config` 生成的 `config_summary`（模型、数据集、引擎、是否要沙箱、是否要 LLM Judge、样本限制）。这是"确认门禁"的视觉落地——让用户在花钱前看清成本。
- `failed`：诊断结果 Alert，内容来自 `diagnose_error` 分类出的失败原因（密钥过期？端点不可达？限流？），让用户知道"为什么失败"而不只是"失败了"。

---

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

**详细说明**

SSE 是平台"实时反馈"的唯一通道，用于把评测进度和日志推给前端。

**后端广播模型**：

`SSEManager` 维护一个进程内映射 `_connections: Dict[int, Set[asyncio.Queue]]`——key 是 `task_id`，value 是这个任务**所有活跃 SSE 连接各自对应的 Queue**（一个浏览器标签页 = 一个连接 = 一个 Queue）。

广播流程：

1. 连接建立时 `connect()` 创建一个 `asyncio.Queue` 并加入该 task_id 的集合。
2. 生产者（工作流节点、stop 接口等）调 `broadcast(task_id, event_type, data)`。
3. `broadcast` 把数据组装成 SSE 帧（`event: <name>\ndata: <json>\n\n`），`put` 到该 task 下所有 Queue。
4. 每个连接的生成器 `await queue.get()` 拿到帧就 `yield` 出去。
5. 连接断开时 `disconnect()` 从集合移除。

**五种事件**（靠 `event:` 字段区分）：

| 事件 | 触发时机 | 前端动作 |
|---|---|---|
| `connected` | 建连时 | 握手确认 |
| `progress` | run_eval 开始(0)、collect_results(100) | 更新进度/步骤 |
| `logs` | 每 2 秒有日志增量时 | 追加日志 |
| `complete` | 任务完成/停止/取消 | `fetchTask()` 重新拉结果 |
| `heartbeat` | 30 秒无数据 | 忽略（保活） |

⚠️ **progress 只有 0 和 100 两个值**——因为父子进程之间没有进度回传通道（详见《评测链路深度拆解》§4.3）。所以"进度条"实际是"没开始 / 完成了"两个点，中间靠 `logs` 让用户知道"它在动"。

**为什么用 SSE 不用 WebSocket**：评测是**服务端单向推**的场景（后端推进度，前端几乎不往回发），SSE 够了；它是普通 HTTP，穿代理/Nginx/鉴权都简单，浏览器 `EventSource` 原生支持自动重连。

**两个已知边界（被问"有什么不满"可主动说）**：

1. **断线重连很朴素**：`onerror` → close → 5 秒后重连，**没有指数退避、没有 `Last-Event-ID`**。漏掉的日志靠 `results.ts` 里的 `/eval/log/{id}` 全量补拉。
2. **进程内广播**：`_connections` 是模块级内存字典，**多 worker 部署会失效**（连接可能建在 worker A、广播发生在 worker B）。单机部署下无此问题，演进方向是 Redis Pub/Sub。

---

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

**详细说明**

AI 助手是一个**只读型 ReAct Agent**，目的是让用户"用自然语言查平台数据"，而不是"用自然语言操作平台"。

**模型从哪里来**：

`ChatOpenAI` 的 `base_url`/`api_key`/`model_name` 全部取自 `ManagedModel` 表——即**任意 OpenAI 兼容端点**（可接通义、DeepSeek、vLLM 部署等），不写死 OpenAI。选模型逻辑：优先 `request.model_id` → 否则默认模型 → 否则任意 active 模型。

**6 个只读工具**（`chat_tools.py`）：

⚠️ **全是查询类**：`query_tasks`、`get_task_detail`、`compare_models`、`list_datasets`、`list_managed_models`、`get_dashboard_summary`。**刻意没有"创建任务""启动评测""停止任务"这类写操作工具**——这是安全边界设计，防止用户（或 prompt 注入）通过聊天助手触发有成本、有副作用的操作。

每个工具都是 `StructuredTool`（Pydantic schema 定义参数）+ 闭包绑定 db session，底层查 SQLAlchemy 或 EvalScope 注册表。

**ReAct 循环与上限**：

`create_react_agent(model, tools, prompt=SYSTEM_PROMPT)` 构建标准 ReAct Agent。设 `MAX_TOOL_ROUNDS=5`，对应 `recursion_limit=12`（每轮 = agent 节点 + tools 节点 = 2 步，5 轮 = 10 步 + 2 buffer）。超限抛 `GraphRecursionError`，防止 Agent 无限调工具跑飞。

**流式输出**：

`astream_events(version="v2")` 监听两类事件：

- `on_chat_model_stream` → 取 `chunk.content` 作为 token 流式推给前端（SSE）。
- `on_tool_start` → 插一句 "正在查询 xxx..." 提示文本。
- 结束时返回 token 用量（usage）和 Langfuse trace_url。

**后端无状态**：

没有 checkpointer、没有 thread_id、不存会话。每次请求由前端全量回传 `messages`，对话历史存在浏览器 `localStorage`（zustand store）。这是轻量场景的取舍——多轮上下文靠前端持有，不做服务端持久化。

**两个已知边界**（被问"有什么不满意"可主动说）：

1. 工具调用的**中间结果前端看不到结构化展示**——只推了 "正在查询..." 文本，没有工具调用气泡/折叠面板。
2. 撞 `recursion_limit` 时**没有兜底成友好提示**——`GraphRecursionError` 直接冒到前端当 error。

---

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

**详细说明**

**业务库 `evalscope.db`** —— 6 张表，全部定义在 `app/db/models.py`：

| 表 | 作用 | 关键字段 |
|---|---|---|
| `evaluation_tasks` | **核心表**，任务全生命周期 | status(枚举)/progress/current_step/results(JSON)/logs/output_dir/error/started_at/completed_at/duration |
| `managed_models` | 已纳管的模型 | name/model_name/api_url/api_key/generation_config |
| `datasets` | 数据集目录缓存 | 从 EvalScope registry 同步 |
| `model_types` | 模型类型目录 | openai_api/llm_ckpt 等 |
| `metrics` | 指标目录 | 从 METRIC_REGISTRY 同步 |
| `users` | 用户 | 配合可选认证 |

`evaluation_tasks` 的几个字段值得注意：

- `results` 是 JSON 字段，只存 `{score, metrics}`（⚠️ 不存 analysis，导致 AI 分析卡片永不渲染，见《评测链路深度拆解》bug 3）。
- `output_dir` 在 run_eval 开头就提前写入，指向 `./data/work/{task_uuid}`。
- ⚠️ `model_key`（在 managed_models 里）是**明文存 SQLite**，没有加密——checkpoint 侧做了脱敏，业务库侧没做，这是已知安全短板。

**checkpoint 库 `evalscope_checkpoints.db`** —— LangGraph `AsyncSqliteSaver` 专用：

- `checkpoints` 表：每个 `thread_id`（= task_id）的检查点快照 + 元数据。
- `writes` 表：检查点之间的增量写入（channel/value）。
- **不存 API Key**：EvalState 里只有 `has_model_key: bool`，真正的 key 在执行时从业务库即时读。
- schema v2 升级时会清掉旧 checkpoint，避免历史快照残留敏感状态。

**为什么两个库分开**（呼应第一章）：checkpoint 是"可丢弃的运行时状态"，业务库是"不可丢的用户数据"。分库后可以安全地单独清空/重建 checkpoint 库（schema 升级、清除残留密钥），而不影响业务数据。

---

## 九、统一执行与数据访问

所有启动入口最终进入 `/api/workflow`。业务状态通过 `app.services.task_state`
和 SQLAlchemy 写入 `DATABASE_URL`；评测子进程不直接访问数据库，只通过队列返回结果和日志。
工作流 checkpoint 使用 `WORKFLOW_CHECKPOINT_DB`，不保存 API Key。升级到安全 schema v2
时会清理旧 checkpoint，避免历史明文密钥残留。

**详细说明**

这一章讲的是**数据访问的边界约束**，是架构上两个刻意的设计决策。

**决策一：评测子进程不碰数据库**

评测在独立的 `multiprocessing.Process` 里跑，它**只负责 `evalscope.run_task()`**，不直接连数据库。结果和日志通过 `multiprocessing.Queue` 回传给父进程（LangGraph 的 `run_eval` 节点），由父进程统一走 `app.services.task_state` 落库。

**为什么**：SQLite 对多进程并发写支持很弱（容易锁冲突、损坏）。让"数据库访问"只发生在主进程（FastAPI 进程），子进程只回传数据，就避开了这个坑。这也是"评测子进程"和"Web 服务进程"边界清晰的原因。

**决策二：密钥 JIT 加载**

checkpoint 里只有 `has_model_key: bool`（"有没有 key"），真正的 `api_key` 在 `run_eval` 执行那一刻才从业务库 SELECT 出来，用完即弃。

**为什么**：checkpoint 会被持久化、还会被 `/status` 接口读出来。如果密钥进了 checkpoint，就等同于"密钥跟着工作流状态到处扩散"，还可能被前端拿到。JIT 加载把密钥的生命周期压缩到一个节点函数的作用域里。

⚠️ **但要诚实**：checkpoint 侧做了脱敏，业务库侧 `model_key` 仍是明文 SQLite。完整的生产方案应该接 KMS 或至少应用层加密。

---

## 十、已知架构问题

1. **单机执行模型**：后台协程、子进程注册表和 SSE 连接都在进程内，不支持多 worker 横向扩展
2. **at-least-once 语义**：服务在长时间 `run_eval` 中崩溃后，需要依赖 EvalScope cache 续测
3. **轮询开销**：confirming 状态持续 3 秒轮询，列表页对 pending 任务批量查询

**详细说明**

这三个是当前架构的已知短板，面试被问"有什么不满意"时可以直接讲，每个都能展开成"问题 → 根因 → 演进方向"。

**问题一：单机执行模型**

三个**进程内内存字典**是单机架构的标志：

| 内存态 | 作用 | 多 worker 下的问题 |
|---|---|---|
| `_workflow_tasks` | asyncio 任务注册表（防 GC + 支持取消） | 任务在 A 进程启动，B 进程查不到 |
| `_eval_processes` | 评测子进程句柄注册表 | 无法跨进程 kill 子进程 |
| `_connections` | SSE 连接注册表 | 连接建在 A、广播发生在 B，收不到 |

**演进方向**：把这三样从"进程内内存"换成"外部共享"——后台任务换成持久化任务队列（Celery/NATS + 租约/心跳），SSE 广播换成 Redis Pub/Sub。这就是"从单机到分布式"的完整路径。

**问题二：at-least-once 语义**

LangGraph 的 checkpoint 只能恢复"流程走到哪个节点"，**不能复活已经死掉的评测子进程**。服务崩溃后重跑，靠 EvalScope 的 `use_cache` 做**样本级续评**（跳过已完成样本，从断点接着评），所以语义是"至少跑完一次"（at-least-once），不是"恰好一次"（exactly-once）。

⚠️ 续评是**样本级**的（EvalScope 每样本完成即 flush 落盘），不是数据集级——这个和"外部进度只有 0/100"不矛盾：外部看不到跑到第几条，但 EvalScope 内部能按样本续跑（详见《评测链路深度拆解》§10）。

**问题三：轮询开销**

`confirming` 态没走 SSE，而是 3 秒轮询；列表页对 pending 任务批量查工作流状态。任务多时请求会放大。**演进方向**：把确认态也纳入 SSE 或改用推送通知，减少无效轮询。
