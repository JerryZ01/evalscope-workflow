#!/usr/bin/env python3
"""临时启动脚本，确保正确的 CWD 和环境变量"""
import os
import sys

os.chdir(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ".")

# 设置环境变量
os.environ.setdefault("LANGFUSE_PUBLIC_KEY", "")
os.environ.setdefault("LANGFUSE_SECRET_KEY", "")
os.environ.setdefault("LANGFUSE_HOST", "")

from main import app
import uvicorn

uvicorn.run(app, host="0.0.0.0", port=5900)
