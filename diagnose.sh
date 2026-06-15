#!/bin/bash

echo "=== 开始诊断任务创建问题 ==="

echo ""
echo "1. 检查前端构建是否成功..."
if [ -f "frontend/dist/index.html" ]; then
    echo "✓ 前端已构建"
    echo "  构建时间: $(stat -c %y frontend/dist/index.html)"
else
    echo "✗ 前端未构建"
fi

echo ""
echo "2. 检查后端服务..."
if pgrep -f "uvicorn.*main:app" > /dev/null; then
    echo "✓ 后端服务运行中"
    echo "  进程: $(pgrep -f 'uvicorn.*main:app')"
else
    echo "✗ 后端服务未运行"
fi

echo ""
echo "3. 检查数据库连接..."
cd backend
python3 << 'EOF'
import asyncio
from app.db.database import get_db
from sqlalchemy import text

async def test_db():
    try:
        async for db in get_db():
            result = await db.execute(text("SELECT 1"))
            print("✓ 数据库连接正常")
            break
    except Exception as e:
        print(f"✗ 数据库连接失败: {e}")

asyncio.run(test_db())
EOF

echo ""
echo "4. 检查已管理的模型..."
python3 << 'EOF'
import asyncio
from app.db.database import get_db
from app.db.models import ManagedModel
from sqlalchemy import select

async def check_models():
    async for db in get_db():
        result = await db.execute(select(ManagedModel).limit(5))
        models = result.scalars().all()
        if models:
            print(f"✓ 找到 {len(models)} 个已管理的模型:")
            for m in models:
                print(f"  - ID: {m.id}, Name: {m.name}, Model Name: {m.model_name}")
        else:
            print("✗ 没有找到已管理的模型")
        break

asyncio.run(check_models())
EOF

cd ..

echo ""
echo "=== 诊断完成 ==="
