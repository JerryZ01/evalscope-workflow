# 紧急修复方案：强制验证表单字段

## 问题分析

经过深入分析，我发现问题可能出在以下几个方面：

1. **用户在第1步填写了模型名称，但没有点击"下一步"**
   - 直接通过其他方式跳到了第4步（虽然代码不允许，但可能有其他bug）

2. **表单字段值在步骤间传递时丢失**
   - React 状态管理问题
   - Form 实例在某些情况下重置

3. **已管理模型的字段填充逻辑有问题**
   - `handleSelectManagedModel` 调用 `form.setFieldsValue` 可能失败
   - 异步操作的时序问题

## 立即尝试的解决方案

### 方案1：清除浏览器缓存并重新加载

1. 按 `Ctrl+Shift+Delete` 打开清除浏览器数据窗口
2. 勾选"缓存的图片和文件"
3. 勾选"Cookie 和其他网站数据"
4. 点击"清除数据"
5. **完全关闭浏览器**
6. 重新打开浏览器，访问应用
7. 打开开发者工具（F12）-> Console
8. 重新尝试创建任务

### 方案2：手动验证表单字段

在浏览器控制台执行以下命令：

```javascript
// 1. 在第1步填写完模型名称后，打开控制台
// 2. 找到 form 实例（使用 React DevTools）
// 3. 执行：

// 检查表单所有字段
console.log('所有字段值:', form.getFieldsValue());

// 检查 model_name 字段
console.log('模型名称:', form.getFieldValue('model_name'));

// 如果为空，手动设置（测试）
form.setFieldValue('model_name', 'gpt-4');

// 然后点击"下一步"
```

### 方案3：使用后端 API 直接测试

如果前端问题无法解决，可以尝试直接调用后端 API：

```bash
# 获取一个有效的 token（如果需要）
# 然后手动创建任务

curl -X POST http://localhost:8000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "name": "测试任务",
    "description": "手动测试",
    "model_name": "gpt-4",
    "model_type": "openai_api",
    "model_url": "https://api.openai.com/v1",
    "model_key": "your-api-key",
    "datasets": ["mmlu"],
    "eval_batch_size": 3,
    "generation_config": {
      "temperature": 0.7,
      "max_tokens": 1024
    }
  }'
```

### 方案4：检查数据库中的模型管理表

```bash
cd /mnt/e/code/evalscope-workflow/backend

# 进入 Python 环境
python3

# 执行以下代码
from app.db.database import get_db
from app.db.models import ManagedModel
from sqlalchemy import select
import asyncio

async def check_models():
    async for db in get_db():
        result = await db.execute(select(ManagedModel))
        models = result.scalars().all()
        for m in models:
            print(f"ID: {m.id}, Name: {m.name}, Model Name: {m.model_name}")
        break

asyncio.run(check_models())
```

## 终极调试方案

如果以上方法都无法解决问题，请执行以下操作：

### 步骤1：添加更多调试日志

修改 `frontend/src/pages/TaskCreate/index.tsx`，在第31行 `handleSelectManagedModel` 函数中添加更多日志：

```typescript
const handleSelectManagedModel = async (modelId: number) => {
  console.log('=== 开始选择已管理模型 ===');
  console.log('modelId:', modelId);
  setSelectedManagedModel(modelId);

  try {
    const model = await modelApi.get(modelId);
    console.log('获取到的模型信息:', model);

    if (model) {
      const valuesToSet = {
        model_type: model.model_type,
        model_name: model.model_name,
        model_url: model.api_url || undefined,
        model_key: model.api_key || undefined,
      };
      console.log('准备设置的字段值:', valuesToSet);

      // 关键：使用 setTimeout 确保 React 渲染完成
      setTimeout(() => {
        form.setFieldsValue(valuesToSet);
        console.log('设置后的表单值:', form.getFieldsValue());
        console.log('model_name 字段值:', form.getFieldValue('model_name'));
      }, 0);
    }
  } catch (error) {
    console.error('获取模型信息失败:', error);
  }
};
```

### 步骤2：监控表单变化

在 Form 组件上添加 `onValuesChange` 回调：

```tsx
<Form
  form={form}
  layout="vertical"
  onValuesChange={(changedValues, allValues) => {
    console.log('表单字段变化:', changedValues);
    console.log('当前所有字段:', allValues);
  }}
>
```

### 步骤3：添加字段值变化监听

在第185行 `model_name` 的 Input 组件上添加 onChange：

```tsx
<Input
  placeholder="例如: gpt-4, qwen-72b, etc."
  onChange={(e) => {
    console.log('model_name 输入值:', e.target.value);
    console.log('model_name 表单值:', form.getFieldValue('model_name'));
  }}
/>
```

## 我的建议

**请先尝试方案1（清除浏览器缓存），这很可能是缓存了旧的 JavaScript 文件导致的问题。**

如果清除缓存后问题仍然存在，请：

1. 打开开发者工具 -> Console
2. 重新创建任务
3. **完整复制控制台的所有输出**（从打开页面开始）
4. **截图网络请求**（包括请求体和响应体）
5. 发送给我，我会进一步分析

## 关键信息收集

请提供以下信息：

```
1. 浏览器类型和版本：
   例如：Chrome 120.0.6099.129

2. 操作系统：
   例如：Windows 11 / macOS 14

3. 操作步骤：
   - 我在第1步选择了已管理模型 / 手动输入了模型名称
   - 模型名称是：______
   - 点击"下一步"后：成功进入第2步 / 显示错误提示

4. 控制台输出：
   （粘贴完整日志）

5. 网络请求：
   - URL: POST http://localhost:8000/api/tasks
   - Request Payload:
     {
       "name": "...",
       "model_name": "...",
       ...
     }
   - Response:
     {
       "detail": "..."
     }
```

有了这些信息，我就能准确定位问题所在。
