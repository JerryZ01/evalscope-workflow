# EvalScope Workflow 技术文档

EvalScope Workflow 是一个全栈评测工作流引擎，为 LLM/ML 模型评测提供 Web UI 管理界面，支持任务创建、实时执行、结果可视化全流程。

## 文档结构

- [系统架构](./architecture.md) - 整体架构设计、数据流、目录结构
- [后端 API](./api.md) - 所有 API 接口详解
- [前端文档](./frontend.md) - 前端页面、功能组件、状态管理
- [用户指南](./guide.md) - 功能使用说明
- [二次开发](./development.md) - 开发规范、接口扩展

## 核心功能

| 功能 | 说明 |
|------|------|
| 任务管理 | 创建、编辑、删除、启动、确认、停止、续测、重试 |
| 访问控制 | 可选共享令牌登录、HttpOnly 会话 Cookie、密钥响应脱敏 |
| 实时进度 | SSE 推送进度更新，日志 3 秒轮询 |
| 评测执行 | 支持 OpenAI API / LLM Checkpoint / Text2Image / Mock 等模型类型 |
| 可视化报告 | 雷达图、柱状图、AI 分析、HTML 报告内嵌 |
| 目录管理 | 数据集、模型类型、评测引擎、指标浏览（中文描述 + Markdown 渲染） |
| 模型管理 | API 凭证存储、默认配置复用 |
| AI 助手 | Function Calling 查询评测数据、多会话管理、历史持久化 |

## 技术栈

- **后端**: Python 3.10+, FastAPI, SQLAlchemy (async), evalscope
- **前端**: React 18, TypeScript, Vite, Ant Design 5, Zustand, @ant-design/plots
- **数据库**: SQLite (默认，async 读写)
- **通信**: REST API + Server-Sent Events (SSE)
