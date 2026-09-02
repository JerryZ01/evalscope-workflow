# 评测工作流迭代计划（LangGraph + Langfuse）

## 项目背景

当前评测流程是"用户手动配置 → 点启动 → 等结果"的一次性操作，存在以下问题：
- 配置错误只能等评测跑完才知道，浪费时间和 API 调用
- 评测失败后没有自动诊断，用户需要自己看日志排查
- Langfuse 上只显示扁平的 trace，看不到流程步骤和分支
- 服务崩溃后评测进度丢失，无法恢复

目标：用 LangGraph StateGraph 编排多步骤工作流，实现人工确认、自动诊断重试、checkpoint 持久化，Langfuse 显示 DAG 流程图。

---

## 分阶段策略

直接上"智能工作流"风险太大——涉及数据库模型改造、checkpoint 持久化、长时间节点崩溃恢复、前端交互大幅重构，一步到位容易做出"表面能用但实际不可靠"的东西。

分两阶段：
- **Phase 1（能用）**：用 LangGraph StateGraph 把现有评测流程编排成多步骤工作流，加 checkpoint 持久化和人工确认节点
- **Phase 2（智能）**：在 Phase 1 基础上加 AI Agent 决策节点（自动诊断、自动调参、结果分析）

---

## Phase 1：多步骤评测工作流

### 状态：已完成后端实现，端到端测试通过

### 工作流设计

```
START → prepare_config → validate_params → [interrupt: 人工确认] → run_eval →
  → 成功 → collect_results → END
  → 失败 → diagnose_error → should_retry(条件路由) →
       → retry → increment_retry → run_eval (重试)
       → stop → mark_failed → END
```

### 各节点职责

| 节点 | 职责 | 耗时 | 状态更新 |
|------|------|------|----------|
| `prepare_config` | 从任务配置构建 TaskConfig，判断沙箱/judge 需求，生成配置摘要 | <1s | current_step="配置已准备" |
| `validate_params` | 校验 API Key、模型 URL 是否提供 | <1s | current_step="参数校验通过/失败" |
| `run_eval` | 子进程执行 `evalscope.run_task()` | 几分钟到几小时 | status=RUNNING, current_step="正在执行评测..." |
| `collect_results` | 解析评测报告，提取 score/metrics，更新数据库 | <1s | status=COMPLETED, current_step="评测完成，得分 X" |
| `diagnose_error` | 解析错误日志，分类（密钥过期/沙箱缺失/模型不可达等） | <1s | current_step="诊断: XXX" |
| `should_retry` | 条件路由：判断错误是否可重试（连接超时/频率限制→重试，其他→停止） | <1s | — |
| `increment_retry` | 增加重试计数，启用断点续测（use_cache） | <1s | current_step="准备重试（第 N 次）" |
| `mark_failed` | 标记任务失败 | <1s | status=FAILED |

### 人工确认机制

- 使用 `interrupt_before=["await_confirmation"]`，在一次性确认节点前暂停；自动重试直接回到 `run_eval`
- 用户通过 `POST /api/workflow/{task_id}/confirm` 提交确认
- 确认时可以携带修改后的配置（`modifications` 字段）
- 确认后评测在后台异步执行（`asyncio.create_task`），不阻塞 HTTP 请求
- 用户通过 `GET /api/workflow/{task_id}/status` 轮询状态

### API 设计

```
POST /api/workflow/{task_id}/start     — 启动工作流（执行到 interrupt 暂停）
GET  /api/workflow/{task_id}/status    — 查询工作流状态（步骤+checkpoint）
POST /api/workflow/{task_id}/confirm   — 确认继续（人工确认节点），评测后台执行
POST /api/workflow/{task_id}/cancel    — 取消工作流
```

### 新增文件

| 文件 | 职责 |
|------|------|
| `backend/app/workflows/state.py` | EvalState TypedDict 定义（task_id, model 配置, datasets, 工作流控制字段, 评测结果字段） |
| `backend/app/workflows/eval_workflow.py` | LangGraph StateGraph 定义 + 8 个节点函数 + AsyncSqliteSaver checkpoint |
| `backend/app/api/workflow.py` | 4 个 API 端点 + 辅助函数 |

### 关键技术决策

1. **Checkpoint 持久化**：`langgraph-checkpoint-sqlite` v3.1.0，用 `AsyncSqliteSaver` + `aiosqlite.connect()` 直接构造。SQLite 文件由 `WORKFLOW_CHECKPOINT_DB` 配置，并且不保存 API Key。

2. **长时间节点（run_eval）处理**：
   - 节点内部用 `multiprocessing.Process` 执行 `run_task()`（与现有 `runner.py` 一致）
   - async 节点用 `await loop.run_in_executor(None, process.join)` 等待子进程
   - 风险：run_eval 跑几小时中途服务崩溃，checkpoint 保存的是 run_eval 开始前的状态，恢复后该节点会重新执行（at-least-once 语义）
   - 缓解：利用 evalscope 自身的 `use_cache` 断点续测机制

3. **confirm 端点后台执行**：评测可能持续很久，`confirm` 用 `asyncio.create_task()` 把 `graph.ainvoke(Command(resume=True))` 放到后台，立即返回 HTTP 响应。用户通过 `status` 端点轮询进度。

4. **状态管理**：工作流状态存在 LangGraph checkpoint 中（SQLite 文件），不新增数据库表。EvaluationTask 的 status 字段由工作流节点同步更新。

5. **should_retry 条件路由**：`should_retry` 不是节点，而是 `diagnose_error` 的条件边路由函数，返回 `"retry"` 或 `"stop"`。避免把路由函数当节点导致的返回值类型问题。

### 已修复的 Bug

| Bug | 原因 | 修复 |
|-----|------|------|
| `_AsyncGeneratorContextManager has no attribute 'setup'` | `AsyncSqliteSaver.from_conn_string()` 返回上下文管理器，不能直接当 saver 用 | 改用 `aiosqlite.connect()` + `AsyncSqliteSaver(conn)` 直接构造 |
| `The SqliteSaver does not support async methods` | 用了同步版 `SqliteSaver` | 改用 `AsyncSqliteSaver` from `langgraph.checkpoint.sqlite.aio` |
| `await outside async function` | `build_eval_workflow()` 是普通函数但有 `await` | 改为 `async def` |
| confirm 端点 Internal Server Error | 直接 `await graph.ainvoke()` 阻塞 HTTP 请求，评测超时 | 改为 `asyncio.create_task()` 后台执行 |
| `state.tasks` 为空导致误判 | `interrupt_before` 后 LangGraph 填充 `state.next` 而非 `state.tasks` | 改为检查 `state.next` |
| should_retry_node 卡住 | `should_retry` 返回字符串而非 dict，不能当普通节点 | 改为条件边路由函数，删除 should_retry_node 节点 |

### 端到端测试结果

```
# 1. 启动工作流
curl -X POST http://localhost:5900/api/workflow/20/start
→ {"status": "started", "task_id": 20, "message": "工作流已启动，正在准备配置..."}

# 2. 查询状态（在 interrupt 处暂停）
curl http://localhost:5900/api/workflow/20/status
→ {
    "waiting_for_confirmation": true,
    "next_step": "await_confirmation",
    "current_step": "参数校验通过",
    "config_summary": "模型: deepseek-v3-2-251201\n数据集: gsm8k\n引擎: native\n样本限制: 10"
  }

# 3. 确认继续
curl -X POST http://localhost:5900/api/workflow/20/confirm -d '{"approved": true}'
→ {"status": "status": "confirmed", "task_id": 20, "message": "评测已开始执行"}

# 4. 等待评测完成，查询结果
curl http://localhost:5900/api/workflow/20/status
→ {
    "waiting_for_confirmation": false,
    "eval_success": true,
    "eval_score": 0.9,
    "current_step": "评测完成，得分 0.9000"
  }
```

### Phase 1 风险

| 风险 | 严重度 | 缓解措施 |
|------|--------|----------|
| 长时间 run_eval 节点崩溃后重跑 | 中 | evalscope use_cache 断点续测 |
| langgraph-checkpoint-sqlite 未生产验证 | 低 | SQLite 事务性写入，单机场景足够 |
| 兼容入口产生行为漂移 | 低 | `/api/eval/run` 和 `/api/tasks/{id}/start` 均委托统一工作流 |
| interrupt_before 重试时也会暂停 | 已解决 | 一次性 `await_confirmation` 节点与重试边分离 |

---

## Phase 1 待完成项

| 项目 | 优先级 | 说明 |
|------|--------|------|
| 前端对接工作流 API | 高 | 任务详情页加"工作流启动/确认/状态"按钮，轮询 status |
| Langfuse DAG 验证 | 高 | 确认一次评测在 Langfuse 上显示完整流程图 |
| 清理临时文件 | 低 | 删除 `run_with_workflow.py`，清理 checkpoint DB 的 -shm/-wal 文件 |
| Git 提交 | 中 | 提交 Phase 1 所有变更到 dev 分支 |
| 异常恢复测试 | 中 | kill 后端 → 重启 → status 查询 → confirm 恢复 |

---

## Phase 2：智能决策工作流

### 状态：未开始，等 Phase 1 稳定后实施

### 目标

在 Phase 1 工作流的步骤间插入 AI Agent 决策节点，实现自动推荐配置、自动诊断、结果分析。

### 新增节点

| 节点 | 职责 | LLM 调用 |
|------|------|----------|
| `recommend_config` | 根据模型类型自动推荐数据集+参数 | 是 |
| `analyze_result` | 分析评测分数，生成人类可读报告 | 是 |
| `diagnose_failure` | 诊断失败原因，建议修复方案 | 是 |
| `adjust_config` | 根据诊断结果调整配置（如降低 batch_size、换数据集） | 是 |

### 工作流升级

```
START → recommend_config → [interrupt: 确认推荐配置] → validate_params → run_eval →
  → 成功 → collect_results → analyze_result → [interrupt: 查看分析] → END
  → 失败 → diagnose_failure → should_retry →
       → Yes → adjust_config → [interrupt: 确认调整] → run_eval
       → No → END
```

### Phase 2 新增依赖

- 工作流节点内的 LLM 调用复用现有 `ChatOpenAI` + `create_react_agent`（chat.py 已有的模式）
- Agent 的工具集复用 `chat_tools.py` 中的 6 个工具 + 新增评测相关工具（如 `read_eval_log`、`adjust_generation_config`）

### Phase 2 风险

| 风险 | 严重度 | 缓解措施 |
|------|--------|----------|
| LLM 决策不可靠（推荐错误配置） | 高 | 关键决策节点后必须 interrupt 等人工确认 |
| LLM 调用增加延迟和成本 | 中 | 诊断/分析节点只在需要时调用，非每次必走 |
| 多次重试可能无限循环 | 中 | 工作流 recursion_limit + 最大重试次数硬限制 |

---

## 文件变更清单

### Phase 1 已变更文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `backend/app/workflows/state.py` | 新增 | EvalState TypedDict |
| `backend/app/workflows/eval_workflow.py` | 新增 | StateGraph + 8 节点 + checkpoint |
| `backend/app/api/workflow.py` | 新增 | 4 个 API 端点 |
| `backend/main.py` | 修改 | 注册 workflow 路由 |
| `backend/app/api/chat.py` | 重写 | LangGraph ReAct agent |
| `backend/app/api/chat_tools.py` | 修改 | StructuredTool 包装 |
| `backend/app/core/config.py` | 修改 | Langfuse 配置注释 |
| `backend/requirements.txt` | 修改 | 新增 langchain/langgraph/langfuse 依赖 |
| `frontend/vite.config.ts` | 修改 | host: '0.0.0.0'（WSL2 访问） |
| `start.sh` | 修改 | Langfuse 配置从 .env 读取 |
| `.env.example` | 新增 | Langfuse 配置模板 |
| `.gitignore` | 修改 | 排除 .env |

### Phase 1 待清理

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/run_with_workflow.py` | 删除 | 临时启动脚本 |
| `backend/evalscope_checkpoints.db-shm` | 删除 | SQLite WAL 临时文件 |
| `backend/evalscope_checkpoints.db-wal` | 删除 | SQLite WAL 临时文件 |
