# 后端 API 文档

## 数据库模型

### EvaluationTask

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | Integer | 主键 |
| `name` | String(255) | 任务名称 |
| `description` | String(1000) | 任务描述 |
| `model_name` | String(255) | 模型标识名 |
| `model_type` | String(50) | 模型类型：`openai_api`, `llm_ckpt`, `text2image`, `mock` |
| `model_url` | String(500) | API 端点 URL |
| `model_key` | String(255) | API Key |
| `generation_config` | JSON | 生成参数：`temperature`, `max_tokens`, `top_p`, `top_k` |
| `datasets` | JSON | 数据集列表，如 `["gsm8k", "mmlu"]` |
| `dataset_args` | JSON | 数据集参数（per-dataset 配置） |
| `limit` | Integer | 样本数限制，null 表示全部 |
| `eval_batch_size` | Integer | 评测批次大小，默认 1 |
| `engine` | String(50) | 评测引擎：`native`, `opencompass`, `vlmeval`, `rag_eval` |
| `status` | Enum | 任务状态：`pending`, `running`, `paused`, `completed`, `failed`, `cancelled` |
| `progress` | Integer | 进度 0-100 |
| `current_step` | String(100) | 当前步骤描述 |
| `results` | JSON | 评测结果：`{score, metrics}` |
| `logs` | Text | 错误日志 |
| `started_at` | DateTime | 开始时间 |
| `completed_at` | DateTime | 完成时间 |
| `duration` | Float | 耗时（秒） |
| `created_at` | DateTime | 创建时间 |
| `updated_at` | DateTime | 更新时间 |

### ManagedModel

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | Integer | 主键 |
| `name` | String(100) | 显示名称 |
| `model_type` | String(50) | 模型类型 |
| `model_name` | String(255) | 模型标识 |
| `api_url` | String(500) | API URL |
| `api_key` | String(255) | API Key |
| `generation_config` | JSON | 默认生成配置 |
| `is_default` | Boolean | 是否默认模型 |
| `use_count` | Integer | 使用次数统计 |
| `is_active` | Boolean | 是否启用 |

---

## 任务管理 `/api/tasks`

### 创建任务

```
POST /api/tasks
Content-Type: application/json

{
  "name": "GSM8K 评测",
  "description": "测试 doubao 模型",
  "model_name": "doubao-1-5-pro-32k-250115",
  "model_type": "openai_api",
  "model_url": "https://ark.cn-beijing.volces.com/api/v3",
  "model_key": "",
  "generation_config": {
    "temperature": 0.7,
    "max_tokens": 1024,
    "top_p": 1.0,
    "top_k": 50
  },
  "datasets": ["gsm8k"],
  "dataset_args": {},
  "limit": 10,
  "eval_batch_size": 1,
  "engine": "native"
}

响应 201:
{
  "id": 11,
  "name": "GSM8K 评测",
  "status": "pending",
  "message": "任务创建成功"
}
```

### 任务列表

```
GET /api/tasks?skip=0&limit=20&status=completed

响应 200:
[
  {
    "id": 8,
    "name": "test-task",
    "model_name": "gpt-4",
    "model_type": "openai_api",
    "datasets": ["gsm8k"],
    "status": "completed",
    "progress": 100,
    "created_at": "2026-04-15T07:00:00",
    ...
  }
]
```

### 任务详情

```
GET /api/tasks/{task_id}

响应 200: 完整的 TaskDetailSchema，包含 results、logs、duration 等所有字段
```

### 更新任务

```
PATCH /api/tasks/{task_id}
Content-Type: application/json

{
  "name": "新名称",
  "model_url": "https://new-endpoint.com",
  "generation_config": {"temperature": 0.9}
}

限制：状态为 running 的任务不可修改。
```

### 删除任务

```
DELETE /api/tasks/{task_id}

响应 200:
{"id": 8, "message": "任务删除成功"}
```

### 启动任务（仅更新状态）

```
POST /api/tasks/{task_id}/start
注意：此接口仅更新状态为 running，不触发实际评测。
      触发评测使用 POST /api/eval/run/{task_id}
```

### 停止任务

```
POST /api/tasks/{task_id}/stop
状态: running → cancelled，计算 duration
```

### 暂停任务

```
POST /api/tasks/{task_id}/pause
状态: running → paused
```

### 恢复任务

```
POST /api/tasks/{task_id}/resume
状态: paused → running
```

### 重试任务

```
POST /api/tasks/{task_id}/retry
状态: failed/cancelled → pending，清除 progress/error
```

---

## 评测执行 `/api/eval`

### 触发评测（核心接口）

```
POST /api/tasks/{task_id}/start        ← 状态改为 running
POST /api/eval/run/{task_id}           ← 触发后台执行（立即返回）

响应:
{
  "message": "评测任务已启动",
  "task_id": 8,
  "status": "running"
}

实际执行在 FastAPI BackgroundTask 中异步进行，包含：
1. 清除旧 results/logs/error（支持重新执行）
2. 创建进度回调 create_progress_callback()
3. 执行 EvalScopeRunner.run_evaluation()
4. 完成后更新 status/score/results/duration
```

### 获取日志

```
GET /api/eval/log/{task_id}

响应:
{
  "task_id": 8,
  "logs": "Evaluating[gsm8k] 100%|...",  // 完整日志文本
  "status": "running",
  "current_step": "正在执行评测...",
  "progress": 40,
  "log_source": "file"  // "file" 或 "db"
}

日志优先从文件系统读取，文件不存在时读取数据库字段。
```

### 获取报告 HTML

```
GET /api/eval/report/{task_id}

直接返回 report.html 文件流（Content-Type: text/html）。
前端通过 <iframe src="/api/eval/report/{id}"> 内嵌展示。
报告使用 Plotly 图表库（CDN 模式，Plotly.js 由后端 /static 路由提供）。
```

### SSE 实时推送

```
GET /api/eval/stream/{task_id}
Content-Type: text/event-stream

事件类型:
- connected: 连接建立确认 {"task_id": 8, "message": "已连接"}
- heartbeat: 每 30 秒一次保持连接 {"task_id": 8}
- progress: 进度更新 {"progress": 40, "current_step": "正在执行评测...", "status": "running"}
- complete: 任务完成 {"status": "completed", "progress": 100, "current_step": "完成"}

前端示例:
const es = new EventSource(`/api/eval/stream/${taskId}`);
es.addEventListener('progress', (e) => {
  const data = JSON.parse(e.data);
  setCurrentTask({ ...currentTask, progress: data.progress, current_step: data.current_step });
});
es.addEventListener('complete', () => fetchTask(taskId));
es.onerror = () => { es.close(); setTimeout(() => connectSSE(), 5000); };
```

---

## 结果查询 `/api/results`

### 评测结果

```
GET /api/results/tasks/{task_id}/results

响应:
{
  "score": 0.85,
  "metrics": [
    {
      "name": "mean_acc",
      "num": 1319,
      "score": 0.85,
      "categories": [...]
    }
  ],
  "analysis": "模型在数学推理任务上表现良好..."
}
```

### 可视化数据

```
GET /api/results/tasks/{task_id}/visualization

响应:
{
  "overview": {
    "score": 0.85,
    "total_samples": 1319,
    "duration": 120.5
  },
  "radar": [          // 雷达图数据：各指标得分
    {"metric": "mean_acc", "score": 0.85}
  ],
  "categories": [     // 柱状图数据：各类别得分
    {"name": "default", "score": 0.85, "num": 1319}
  ],
  "analysis": "..."
}
```

### 模型趋势

```
GET /api/results/models/{model_name}/trend?dataset=gsm8k

响应:
{
  "model_name": "gpt-4",
  "dataset": "gsm8k",
  "runs": [
    {"completed_at": "2026-04-10T12:00:00", "score": 0.80},
    {"completed_at": "2026-04-15T07:00:00", "score": 0.85}
  ]
}
```

### 模型对比

```
GET /api/results/compare?model_names=gpt-4,qwen-72b&dataset=gsm8k

响应:
{
  "dataset": "gsm8k",
  "models": [
    {"name": "gpt-4", "latest_score": 0.85, "runs": 5},
    {"name": "qwen-72b", "latest_score": 0.78, "runs": 3}
  ]
}
```

---

## 目录 `/api/catalog`

### 数据集列表

```
GET /api/catalog/datasets?search=math&tag=text&skip=0&limit=50

响应:
{
  "total": 120,
  "datasets": [
    {
      "name": "gsm8k",
      "pretty_name": "GSM8K",
      "description": "Grade School Math 8K...",
      "tags": ["math", "reasoning"],
      "subset_list": ["main"],
      "few_shot_num": 4,
      "metric_list": ["mean_acc"],
      "output_types": ["text"]
    }
  ]
}
```

### 模型类型列表

```
GET /api/catalog/models

响应:
{
  "model_types": [
    {"name": "openai_api", "description": "OpenAI 兼容 API"},
    {"name": "llm_ckpt", "description": "LLM Checkpoint (ModelScope)"},
    ...
  ]
}
```

### 指标列表

```
GET /api/catalog/metrics?category=text

响应:
{
  "total": 15,
  "metrics": [
    {"name": "mean_acc", "description": "平均准确率", "category": "text"}
  ]
}
```

### 评测引擎

```
GET /api/catalog/engines

响应:
{
  "engines": [
    {"name": "native", "description": "EvalScope Native"},
    {"name": "opencompass", "description": "OpenCompass"},
    {"name": "vlmeval", "description": "VLMEvalKit"},
    {"name": "rag_eval", "description": "RAG-Eval"}
  ]
}
```

---

## 模型管理 `/api/models`

### 创建模型

```
POST /api/models
{
  "name": "我的 GPT-4",
  "model_type": "openai_api",
  "model_name": "gpt-4",
  "api_url": "https://api.openai.com/v1",
  "api_key": "sk-xxx",
  "generation_config": {"temperature": 0.7},
  "is_default": true
}
```

### 模型列表（轻量）

```
GET /api/models/brief

响应:
[
  {"id": 1, "name": "我的 GPT-4", "model_type": "openai_api",
   "model_name": "gpt-4", "api_url": "https://...", "is_default": true}
]
```

---

## 错误响应格式

所有 API 错误统一返回 `HTTPException`，响应格式：

```json
{
  "detail": "任务 99 不存在"
}
```

状态码规范：
- `400` - 请求参数错误 / 状态不允许操作
- `404` - 资源不存在
- `500` - 服务器内部错误
