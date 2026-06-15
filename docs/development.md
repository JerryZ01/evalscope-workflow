# 二次开发指南

## 环境搭建

### 前置要求

- Python 3.10+
- Node.js 18+
- npm 或 yarn
- Conda 环境（推荐）

### 安装步骤

```bash
# 1. 克隆项目
git clone <repo-url>
cd evalscope-workflow

# 2. 创建 Python 环境
conda create -n evalscope python=3.10 -y
conda activate evalscope
pip install -r backend/requirements.txt

# 3. 安装前端依赖
cd frontend
npm install
```

### 启动开发服务

```bash
# 后端（端口 8000）
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# 前端（端口 5173，代理 /api 到 8000）
cd frontend
npm run dev
```

### 配置

后端通过环境变量配置（详见 [architecture.md](./architecture.md#配置管理)）：

```bash
export DATABASE_URL="sqlite+aiosqlite:///./evalscope.db"
export DEBUG=True
export HOST=0.0.0.0
export PORT=8000
```

---

## 添加新的评测引擎

### 1. 注册引擎

编辑 `backend/evalscope_wrapper/catalog.py`，在 `CatalogService.get_all_engines()` 中添加：

```python
{
    "name": "my_engine",
    "description": "我的自定义评测引擎"
}
```

### 2. 实现后端支持

在 `backend/app/api/` 中新增路由文件，或扩展现有路由。

若需自定义评测逻辑，在 `evalscope_wrapper/runner.py` 中新增执行器类：

```python
class MyEngineRunner:
    async def run_evaluation(self, task_config, progress_callback):
        # 实现自定义评测逻辑
        # 定期调用 progress_callback(progress, message)
        pass
```

### 3. 前端支持

在 `frontend/src/pages/TaskCreate/` 的引擎选择器中添加选项。

---

## 添加新的 API 端点

### 后端

在 `backend/app/api/` 下对应模块中新增路由：

```python
# backend/app/api/myapi.py
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.database import get_db

router = APIRouter()

@router.get("/items")
async def list_items(db: AsyncSession = Depends(get_db)):
    ...
```

在 `main.py` 中注册：

```python
from app.api import myapi
app.include_router(myapi.router, prefix="/api/myapi", tags=["我的模块"])
```

### 前端

在 `frontend/src/api/` 下新增 API 文件：

```typescript
// frontend/src/api/myapi.ts
import client from './client';

export const myApi = {
  listItems: () => client.get('/myapi/items'),
};
```

---

## 添加新的任务状态

### 1. 枚举

编辑 `backend/app/db/models.py`：

```python
class TaskStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    NEW_STATUS = "new_status"  # 新增
```

### 2. 前端标签显示

编辑 `frontend/src/pages/TaskDetail/index.tsx` 的 `getStatusTag()` 函数：

```typescript
const config: Record<string, { color: string; label: string }> = {
  new_status: { color: 'purple', label: '新状态' },
  // ...existing
};
```

### 3. 按钮逻辑

在 `TaskList` 的操作按钮区添加新状态的处理逻辑。

---

## 扩展结果可视化

评测结果存储在 `task.results` JSON 字段中：

```json
{
  "score": 0.85,
  "metrics": [
    {
      "name": "mean_acc",
      "score": 0.85,
      "num": 1319,
      "categories": [...]
    }
  ]
}
```

### 添加新的图表

在 `TaskDetail` 的已完成状态区域添加：

```typescript
import { Pie } from '@ant-design/plots';

// 在 renderRadarChart / renderBarChart 后添加
const renderPieChart = () => {
  const config = {
    data: vizData?.categories || [],
    angleField: 'num',
    colorField: 'name',
    radius: 0.8,
  };
  return <Pie {...config} />;
};
```

---

## 数据库迁移

使用 SQLAlchemy 的 `create_all` 自动创建表（不支持 schema 变更）：

```bash
# 手动修改字段后重启服务即可
# 对于生产环境，建议使用 alembic 进行迁移
pip install alembic
alembic init alembic
```

---

## 测试

```bash
# 后端单元测试
cd backend
pytest tests/ -v

# 前端类型检查
cd frontend
npx tsc --noEmit

# 前端构建
cd frontend
npm run build
```

---

## 部署注意事项

### 生产环境

1. **关闭 DEBUG**: `export DEBUG=False`
2. **CORS 配置**: 限制 `CORS_ORIGINS` 为实际前端域名
3. **数据库**: 生产环境建议使用 PostgreSQL
   ```bash
   export DATABASE_URL="postgresql+asyncpg://user:pass@host/db"
   ```
4. **静态文件**: 可使用 Nginx 反向代理 `/static` 到独立 CDN

### Nginx 配置示例

```nginx
server {
    listen 80;
    server_name evalscope.example.com;

    location / {
        proxy_pass http://localhost:5173;  # 前端
    }

    location /api {
        proxy_pass http://localhost:8000;  # 后端
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }

    location /static {
        alias /path/to/backend/app/static;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### Supervisor 部署后端

```ini
[program:evalscope]
command=python -m uvicorn main:app --host 0.0.0.0 --port 8000
directory=/path/to/backend
user=www-data
autostart=true
autorestart=true
stderr_logfile=/var/log/evalscope.err.log
stdout_logfile=/var/log/evalscope.out.log
```
