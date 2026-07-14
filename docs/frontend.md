# 前端文档

## 技术栈

| 库 | 版本 | 用途 |
|---|---|---|
| React | 18 | UI 框架 |
| TypeScript | - | 类型系统 |
| Vite | - | 构建工具 |
| Ant Design | 5 | UI 组件库 |
| @ant-design/plots | - | 图表（Radar、Column） |
| Zustand | - | 状态管理 |
| Axios | - | HTTP 客户端 |
| React Router | 6 | 路由管理 |

## 项目结构

```
src/
├── main.tsx              # 入口：BrowserRouter + ConfigProvider (zh_CN)
├── App.tsx               # 路由表 + 目录数据预加载（fetchDatasets/Models/Metrics）
├── api/
│   ├── client.ts         # Axios 实例（baseURL: /api，超时 60s）
│   ├── tasks.ts          # 任务 CRUD + 生命周期 API
│   ├── results.ts        # 结果查询 + evalApi（日志/报告/SSE）
│   ├── catalog.ts        # 目录 API
│   ├── models.ts         # 模型管理 API
│   ├── settings.ts       # 设置 API
│   └── chat.ts           # AI 助手聊天 API（SSE 流式）
├── stores/
│   ├── index.ts          # Zustand stores
│   │                     #   useTaskStore: tasks[], currentTask, actions
│   │                     #   useCatalogStore: datasets[], models[], metrics[]
│   └── chatStore.ts      # AI 助手 store（多会话管理 + localStorage 持久化）
├── types/
│   └── index.ts          # 所有 TypeScript 接口（Task, Dataset, Report 等）
├── components/
│   └── AIChat/           # AI 助手组件
│       ├── ChatMessageList.tsx  # 消息列表（Markdown 渲染 + Loading）
│       └── ChatInput.tsx        # 输入框 + 发送/停止按钮
└── pages/
    ├── Dashboard/        # 首页
    ├── TaskList/         # 任务列表
    ├── TaskCreate/       # 创建任务（4步向导）
    ├── TaskEdit/         # 编辑任务（4步向导）
    ├── TaskDetail/       # 任务详情（进度/配置/图表/日志/报告）
    ├── Catalog/          # 目录浏览（中文描述 + Markdown 渲染）
    ├── Models/           # 模型管理
    ├── AIChat/           # AI 助手（对话 + 会话列表）
    └── Settings/         # 系统设置
```

## 路由

| 路径 | 组件 | 说明 |
|------|------|------|
| `/` | → `/dashboard` | 重定向 |
| `/dashboard` | `Dashboard` | 首页统计 |
| `/tasks` | `TaskList` | 任务列表 |
| `/tasks/create` | `TaskCreate` | 创建任务 |
| `/tasks/:taskId/edit` | `TaskEdit` | 编辑任务 |
| `/tasks/:taskId` | `TaskDetail` | 任务详情 |
| `/catalog` | `Catalog` | 数据集/模型/指标目录 |
| `/models` | `Models` | 已管理模型 |
| `/ai-chat` | `AIChat` | AI 助手（多会话对话） |
| `/settings` | `SettingsPage` | 系统设置 |

## 状态管理

### useTaskStore

```typescript
interface TaskStore {
  tasks: Task[];
  currentTask: Task | null;
  loading: boolean;
  fetchTasks: (params?) => Promise<void>;
  fetchTask: (id: number) => Promise<void>;
  createTask: (data) => Promise<void>;
  updateTask: (id, data) => Promise<void>;
  deleteTask: (id) => Promise<void>;
  startTask: (id) => Promise<void>;
  stopTask: (id) => Promise<void>;
  resumeTask: (id) => Promise<void>;
  retryTask: (id) => Promise<void>;
  setCurrentTask: (task) => void;
}
```

### useCatalogStore

```typescript
interface CatalogStore {
  datasets: Dataset[];
  models: ModelType[];
  metrics: Metric[];
  fetchDatasets: (params?: {search?, tag?, limit?}) => Promise<void>;
  fetchModels: () => Promise<void>;
  fetchMetrics: () => Promise<void>;
}
```

### useChatStore

```typescript
interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface ChatStore {
  // 会话
  sessions: ChatSession[];
  activeSessionId: string | null;
  messages: ChatMessage[];
  // 模型
  models: ManagedModelBrief[];
  selectedModelId: number | null;
  // 状态
  loading: boolean;
  error: string | null;
  // 会话操作
  createSession: () => string;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  // 消息操作
  sendMessage: (content: string) => Promise<void>;
  stopStreaming: () => void;
  clearMessages: () => void;
  // 模型操作
  setSelectedModel: (modelId: number) => void;
  fetchModels: () => Promise<void>;
}

// 持久化：会话列表和消息自动保存到 localStorage
// 初始化时自动恢复上次的活跃会话
// 如果没有会话，自动创建第一个
```

## 核心功能实现

### SSE 实时进度（TaskDetail）

```typescript
// 建立 SSE 连接
const connectSSE = useCallback(() => {
  const es = new EventSource(`/api/eval/stream/${taskId}`);
  es.addEventListener('connected', ...);
  es.addEventListener('progress', (e) => {
    const data = JSON.parse(e.data);
    setCurrentTask({ ...currentTask, progress: data.progress, current_step: data.current_step, status: data.status });
  });
  es.addEventListener('complete', () => fetchTask(Number(taskId)));
  es.addEventListener('heartbeat', () => {});
  es.onerror = () => {
    es.close();
    setTimeout(() => currentTask?.status === 'running' && connectSSE(), 5000);
  };
}, [taskId]);

// 根据任务状态管理连接生命周期
useEffect(() => {
  if (taskId && currentTask?.status === 'running') {
    connectSSE();
    logsPollingRef.current = setInterval(loadLogs, 3000);
  }
  return () => { es?.close(); clearInterval(logsPollingRef.current); };
}, [taskId, currentTask?.status]);
```

### iframe 内嵌报告

```typescript
// 报告通过 /api/eval/report/{taskId} 直接返回 HTML 流
// 前端直接用 iframe src 指向该端点，避免 srcDoc + sandbox 限制
{currentTask.status === 'completed' && (
  <iframe
    key={reportKey}  // 刷新时改变 key 强制重新加载
    src={`/api/eval/report/${taskId}`}
    title="评测报告"
    style={{ width: '100%', height: 600 }}
  />
)}
```

### 编辑任务弹窗

```typescript
// EditTaskModal - 内嵌于 TaskDetail
// 弹出后从 currentTask 填充表单
// 支持两种操作:
//  - 仅保存: updateTask() → fetchTask()
//  - 保存并重新执行: updateTask() → evalApi.run() → fetchTask()
```

### 图表可视化

```typescript
// 雷达图 - 指标得分
const radarConfig = {
  data: vizData.radar.map(item => ({ metric: item.metric, score: item.score * 100 })),
  xField: 'metric', yField: 'score',
  meta: { score: { min: 0, max: 100 } },
  area: { style: { fill: '#1890ff', opacity: 0.3 } },
};
<Radar {...radarConfig} />

// 柱状图 - 类别得分
const barConfig = {
  data: vizData.categories.map(item => ({ category: item.name, score: item.score * 100 })),
  xField: 'score', yField: 'category',
};
<Column {...barConfig} />
```

## API 客户端

```typescript
// client.ts - Axios 配置
const client = axios.create({
  baseURL: '/api',
  timeout: 60000,
});

// 响应拦截器：统一提取 error.response.data.detail
client.interceptors.response.use(
  response => response,
  error => {
    const detail = error.response?.data?.detail;
    const message = Array.isArray(detail) ? detail.map(d => d.msg).join(', ') :
                    typeof detail === 'string' ? detail : error.message;
    return Promise.reject(new Error(message));
  }
);
```

## 任务状态流转

```
                    ┌──────────────┐
                    │   PENDING    │ ←── 新建 / 重试
                    └──────┬───────┘
                           │ 启动
                           ▼
                    ┌──────────────┐
            ┌───────│   RUNNING    │───────┐
            │       └──────────────┘       │
            │             完成            │ 停止
            │             ▼               ▼
            │      ┌────────────┐  ┌──────────┐
            │      │ COMPLETED  │  │CANCELLED │
            │      └────────────┘  └────┬─────┘
            │                           │ 重试/续测
            └───────────────────────────▼───────┘
                       ┌──────────────┐
                       │   PENDING    │
                       └──────────────┘

失败 (任务执行异常):
     ┌──────────────┐
     │   FAILED     │ ──→ 重试 → PENDING → 运行
     └──────────────┘

注意: COMPLETED 状态的任务可以直接重新执行（无需重试），
      PENDING/COMPLETED/FAILED/CANCELLED 均可修改参数。
```

## 组件清单

| 组件 | 位置 | 说明 |
|------|------|------|
| `Layout` | `components/Layout/` | 侧边栏（深色渐变）+ 顶部头部 |
| `EditTaskModal` | `pages/TaskDetail/EditTaskModal.tsx` | 任务参数弹窗编辑 |
| `ChatMessageList` | `components/AIChat/ChatMessageList.tsx` | AI 助手消息列表（Markdown + Loading Spin） |
| `ChatInput` | `components/AIChat/ChatInput.tsx` | AI 助手输入框（发送/停止按钮） |
| `Dashboard` | `pages/Dashboard/` | 统计卡片 + 近期任务 |
| `TaskList` | `pages/TaskList/` | 搜索表格 + 状态按钮 |
| `TaskCreate` | `pages/TaskCreate/` | 4步创建向导 |
| `TaskEdit` | `pages/TaskEdit/` | 4步编辑向导 |
| `TaskDetail` | `pages/TaskDetail/` | 详情页（SSE + 图表 + 日志 + 报告） |
| `Catalog` | `pages/Catalog/` | 标签页切换（数据集/模型/指标）+ 中文描述 Markdown 渲染 |
| `AIChat` | `pages/AIChat/` | AI 助手（对话区 + 左侧会话列表） |
| `Models` | `pages/Models/` | 卡片网格 + CRUD 弹窗 |
| `Settings` | `pages/Settings/` | 配置表单 |
