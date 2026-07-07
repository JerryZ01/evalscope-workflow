"""
EvalScope 注册表包装器
提供对 EvalScope 核心功能的访问
"""
from typing import List, Dict, Any, Optional
import subprocess
import json
import logging
import os
import re

logger = logging.getLogger(__name__)


class EvalScopeRegistry:
    """EvalScope 注册表包装器"""

    # 预加载的中文描述缓存 {name: description_zh}
    _zh_cache: Dict[str, str] = {}
    _zh_loaded: bool = False

    # 需要沙箱执行的数据集（基于标签 'Coding' 或硬编码列表）
    SANDBOX_REQUIRED_DATASETS = {
        'mbpp', 'humaneval', 'mbpp_plus', 'humaneval_plus',
        'multiple_mbpp', 'multiple_humaneval',
        'live_code_bench', 'scicode',
        'swe_bench_lite', 'swe_bench_verified',
        'swe_bench_lite_agentic', 'swe_bench_verified_agentic',
        'swe_bench_verified_mini', 'swe_bench_verified_mini_agentic',
        'terminal_bench_v2', 'tau_bench', 'tau2_bench',
    }

    # 需要 LLM 评判器（judge）的数据集
    # 这类数据集答案复杂，无法用简单匹配判断，需要 LLM 来判断答案是否正确
    JUDGE_REQUIRED_DATASETS = {
        'minerva_math', 'math', 'math_qa', 'math_500', 'olympiad_bench',
        'gsm8k_v', 'docmath', 'math_vista', 'math_verse', 'math_vision',
        'longbench_v2', 'simple_qa', 'chinese_simpleqa', 'general_qa',
        'arena_hard', 'alpaca_eval', 'frames', 'health_bench',
        'process_bench', 'tir_bench', 'poly_math',
    }

    @staticmethod
    def _load_zh_descriptions():
        """从 evalscope _meta/ 目录预加载所有中文描述到内存"""
        if EvalScopeRegistry._zh_loaded:
            return
        try:
            import evalscope.benchmarks
            meta_dir = os.path.join(os.path.dirname(evalscope.benchmarks.__file__), '_meta')
            if not os.path.isdir(meta_dir):
                logger.warning(f"_meta 目录不存在: {meta_dir}")
                EvalScopeRegistry._zh_loaded = True
                return
            for f in os.listdir(meta_dir):
                if not f.endswith('.json'):
                    continue
                name = f[:-5]  # 去掉 .json
                try:
                    with open(os.path.join(meta_dir, f), encoding='utf-8') as fh:
                        data = json.load(fh)
                        zh = data.get('readme', {}).get('zh', '')
                        if zh:
                            EvalScopeRegistry._zh_cache[name] = zh
                except Exception as e:
                    logger.debug(f"加载 {f} 中文描述失败: {e}")
            logger.info(f"预加载中文描述完成: {len(EvalScopeRegistry._zh_cache)} 条")
        except Exception as e:
            logger.warning(f"预加载中文描述失败: {e}")
        finally:
            EvalScopeRegistry._zh_loaded = True

    @staticmethod
    def _is_sandbox_required(name: str, tags: List[str]) -> bool:
        """
        判断数据集是否需要沙箱执行

        Args:
            name: 数据集名称
            tags: 数据集标签

        Returns:
            bool: 是否需要沙箱
        """
        # 优先根据标签判断
        if 'Coding' in tags:
            return True
        # 备用：根据硬编码列表
        return name.lower() in EvalScopeRegistry.SANDBOX_REQUIRED_DATASETS

    @staticmethod
    def _is_judge_required(name: str) -> bool:
        """
        判断数据集是否需要 LLM 评判器

        Args:
            name: 数据集名称

        Returns:
            bool: 是否需要 LLM judge
        """
        return name.lower() in EvalScopeRegistry.JUDGE_REQUIRED_DATASETS

    @staticmethod
    def get_all_datasets() -> List[Dict[str, Any]]:
        """
        获取所有已注册的数据集

        Returns:
            List[Dict]: 数据集列表，每个包含:
                - name: 数据集名称
                - pretty_name: 可读名称
                - description: 描述
                - tags: 标签列表
                - subset_list: 子集列表
                - few_shot_num: few-shot 数量
                - metric_list: 指标列表
                - output_types: 输出类型
                - need_sandbox: 是否需要沙箱执行
        """
        try:
            from evalscope.api.registry import BENCHMARK_REGISTRY

            # 首次调用时预加载中文描述
            EvalScopeRegistry._load_zh_descriptions()

            datasets = []
            for name, meta in BENCHMARK_REGISTRY.items():
                tags = list(getattr(meta, 'tags', []) or [])
                datasets.append({
                    'name': name,
                    'pretty_name': getattr(meta, 'pretty_name', name),
                    'description': getattr(meta, 'description', ''),
                    'description_zh': EvalScopeRegistry._zh_cache.get(name, ''),
                    'tags': tags,
                    'subset_list': list(getattr(meta, 'subset_list', ['default'])),
                    'few_shot_num': getattr(meta, 'few_shot_num', 0),
                    'metric_list': list(getattr(meta, 'metric_list', [])),
                    'output_types': list(getattr(meta, 'output_types', [])),
                    'need_sandbox': EvalScopeRegistry._is_sandbox_required(name, tags),
                    'need_judge': EvalScopeRegistry._is_judge_required(name)
                })

            return datasets

        except ImportError as e:
            logger.error(f"无法导入 EvalScope: {e}")
            return []

        except Exception as e:
            logger.error(f"获取数据集列表失败: {e}")
            return []

    @staticmethod
    def _fetch_chinese_description(name: str) -> Optional[str]:
        """
        调用 evalscope benchmark-info 获取中文描述

        Args:
            name: 数据集名称

        Returns:
            Optional[str]: 中文 Markdown 描述，失败返回 None
        """
        try:
            # 使用 conda run 在 evalscope 环境中执行
            result = subprocess.run(
                ['conda', 'run', '-n', 'evalscope', '--no-capture-output',
                 'evalscope', 'benchmark-info', name, '--format', 'json'],
                capture_output=True,
                text=True,
                timeout=60,
                env={**os.environ, 'NO_COLOR': '1'}  # 禁用颜色输出
            )

            if result.returncode != 0:
                logger.warning(f"benchmark-info 命令失败: {result.stderr}")
                return None

            # 清理 ANSI 颜色代码
            output = re.sub(r'\x1b\[[0-9;]*m', '', result.stdout)

            # 找到 JSON 开始位置（第一个 {）
            json_start = output.find('{')
            if json_start == -1:
                logger.warning(f"输出中未找到 JSON 数据")
                return None

            json_str = output[json_start:]
            try:
                info = json.loads(json_str)
                readme = info.get('readme', {})
                readme_zh = readme.get('zh', '') if isinstance(readme, dict) else ''
                if readme_zh:
                    logger.info(f"成功获取 {name} 中文描述，长度: {len(readme_zh)}")
                    return readme_zh
                else:
                    logger.warning(f"readme.zh 为空")
            except json.JSONDecodeError as e:
                logger.warning(f"JSON 解析失败: {e}")

            return None

        except subprocess.TimeoutExpired:
            logger.warning(f"获取 {name} 中文描述超时")
            return None
        except Exception as e:
            logger.warning(f"获取 {name} 中文描述失败: {e}")
            return None

    @staticmethod
    def get_dataset_by_name(name: str) -> Optional[Dict[str, Any]]:
        """
        获取指定数据集

        Args:
            name: 数据集名称

        Returns:
            Optional[Dict]: 数据集信息，不存在则返回 None
        """
        try:
            from evalscope.api.registry import BENCHMARK_REGISTRY

            if name not in BENCHMARK_REGISTRY:
                return None

            meta = BENCHMARK_REGISTRY[name]
            tags = list(getattr(meta, 'tags', []) or [])
            dataset = {
                'name': name,
                'pretty_name': getattr(meta, 'pretty_name', name),
                'description': getattr(meta, 'description', ''),
                'tags': tags,
                'subset_list': list(getattr(meta, 'subset_list', ['default'])),
                'few_shot_num': getattr(meta, 'few_shot_num', 0),
                'metric_list': list(getattr(meta, 'metric_list', [])),
                'output_types': list(getattr(meta, 'output_types', [])),
                'need_sandbox': EvalScopeRegistry._is_sandbox_required(name, tags),
                'need_judge': EvalScopeRegistry._is_judge_required(name),
                'dataset_id': getattr(meta, 'dataset_id', ''),
                'default_subset': getattr(meta, 'default_subset', 'default'),
                'prompt_template': getattr(meta, 'prompt_template', None),
                'system_prompt': getattr(meta, 'system_prompt', None)
            }

            # 获取中文描述
            description_zh = EvalScopeRegistry._fetch_chinese_description(name)
            if description_zh:
                dataset['description_zh'] = description_zh

            return dataset

        except Exception as e:
            logger.error(f"获取数据集 {name} 失败: {e}")
            return None

    @staticmethod
    def get_all_model_types() -> List[Dict[str, Any]]:
        """
        获取所有已注册的模型类型

        Returns:
            List[Dict]: 模型类型列表
        """
        try:
            from evalscope.api.registry import MODEL_APIS

            models = []
            for name, cls in MODEL_APIS.items():
                # 获取类的文档字符串作为描述
                description = cls.__doc__ if cls.__doc__ else f"{name} 模型"
                models.append({
                    'name': name,
                    'description': description.strip(),
                    # 可以扩展更多配置字段
                    'config_schema': {
                        'model_name': {'type': 'string', 'required': True},
                        'api_url': {'type': 'string', 'required': False},
                        'api_key': {'type': 'string', 'required': False, 'secret': True}
                    }
                })

            return models

        except ImportError as e:
            logger.error(f"无法导入 EvalScope: {e}")
            return []

        except Exception as e:
            logger.error(f"获取模型类型列表失败: {e}")
            return []

    @staticmethod
    def get_all_metrics() -> List[Dict[str, Any]]:
        """
        获取所有已注册的指标

        Returns:
            List[Dict]: 指标列表
        """
        try:
            from evalscope.api.registry import METRIC_REGISTRY

            metrics = []
            for name, cls in METRIC_REGISTRY.items():
                description = cls.__doc__ if cls.__doc__ else f"{name} 指标"
                metrics.append({
                    'name': name,
                    'description': description.strip()
                })

            return metrics

        except ImportError as e:
            logger.error(f"无法导入 EvalScope: {e}")
            return []

        except Exception as e:
            logger.error(f"获取指标列表失败: {e}")
            return []

    @staticmethod
    def get_all_engines() -> List[Dict[str, Any]]:
        """
        获取所有支持的评测引擎

        Returns:
            List[Dict]: 引擎列表
        """
        # EvalScope 支持的引擎
        engines = [
            {
                'name': 'native',
                'description': 'EvalScope 原生评估引擎',
                'supported_types': ['llm', 'vlm', 'embedding', 'reranker', 'aigc']
            },
            {
                'name': 'opencompass',
                'description': 'OpenCompass 文本评估引擎',
                'supported_types': ['llm']
            },
            {
                'name': 'vlmeval',
                'description': 'VLMEvalKit 多模态评估引擎',
                'supported_types': ['vlm']
            },
            {
                'name': 'rag_eval',
                'description': 'RAG 评估引擎',
                'supported_types': ['embedding', 'reranker']
            }
        ]

        return engines