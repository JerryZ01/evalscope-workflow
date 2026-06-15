"""
EvalScope Wrapper - 封装 EvalScope 的注册表和执行能力
"""
from .catalog import CatalogService
from .executor import EvalScopeExecutor

__all__ = [
    "CatalogService",
    "EvalScopeExecutor",
]