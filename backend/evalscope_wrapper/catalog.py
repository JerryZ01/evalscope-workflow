"""
Catalog Service - 封装 EvalScope 注册表，提供目录信息服务
"""
from typing import Any, Dict, List, Optional
import copy


class CatalogService:
    """EvalScope 目录服务"""

    def __init__(self):
        self._benchmarks = None
        self._model_apis = None
        self._metrics = None

    @property
    def benchmarks(self) -> Dict[str, Any]:
        if self._benchmarks is None:
            self._load_benchmarks()
        return self._benchmarks

    @property
    def model_apis(self) -> List[str]:
        if self._model_apis is None:
            self._load_model_apis()
        return self._model_apis

    @property
    def metrics(self) -> List[str]:
        if self._metrics is None:
            self._load_metrics()
        return self._metrics

    def _load_benchmarks(self):
        try:
            import evalscope  # noqa: F401
            from evalscope.api.registry import BENCHMARK_REGISTRY

            self._benchmarks = {}
            for name, meta in BENCHMARK_REGISTRY.items():
                meta_dict = copy.deepcopy(meta.to_string_dict()) if hasattr(meta, 'to_string_dict') else {
                    'name': getattr(meta, 'name', name),
                    'pretty_name': getattr(meta, 'pretty_name', name),
                    'dataset_id': getattr(meta, 'dataset_id', ''),
                    'tags': getattr(meta, 'tags', []),
                    'description': getattr(meta, 'description', ''),
                    'subset_list': getattr(meta, 'subset_list', []),
                    'few_shot_num': getattr(meta, 'few_shot_num', 0),
                }
                self._benchmarks[name] = meta_dict
        except ImportError as e:
            print(f'Warning: Failed to import EvalScope: {e}')
            self._benchmarks = {}

    def _load_model_apis(self):
        try:
            import evalscope  # noqa: F401
            from evalscope.api.registry import MODEL_APIS

            self._model_apis = sorted(list(MODEL_APIS.keys()))
        except ImportError as e:
            print(f'Warning: Failed to import EvalScope: {e}')
            self._model_apis = []

    def _load_metrics(self):
        try:
            import evalscope  # noqa: F401
            from evalscope.api.registry import METRIC_REGISTRY

            self._metrics = sorted(list(METRIC_REGISTRY.keys()))
        except ImportError as e:
            print(f'Warning: Failed to import EvalScope: {e}')
            self._metrics = []

    def get_all_datasets(self) -> List[Dict[str, Any]]:
        seen_names = set()
        datasets = []

        for name, meta in self.benchmarks.items():
            if name in seen_names:
                continue
            seen_names.add(name)

            tags = meta.get('tags', []) or []
            category = tags[0] if tags else 'Other'
            datasets.append({
                'name': name,
                'pretty_name': meta.get('pretty_name', name) or name,
                'description': meta.get('description', '') or '',
                'tags': tags,
                'few_shot_num': int(meta.get('few_shot_num', 0) or 0),
                'subset_list': meta.get('subset_list', []) or [],
                'category': category,
            })

        datasets.sort(key=lambda item: item['pretty_name'].lower())
        return datasets

    def get_dataset_detail(self, name: str) -> Optional[Dict[str, Any]]:
        return self.benchmarks.get(name)

    def get_all_tags(self) -> List[str]:
        tags = set()
        for meta in self.benchmarks.values():
            tags.update(meta.get('tags', []) or [])
        return sorted(list(tags))

    def get_model_types(self) -> List[Dict[str, Any]]:
        model_type_info = {
            'openai_compatible': {
                'name': 'openai_api',
                'display_name': 'OpenAI API 兼容',
                'description': '调用 OpenAI 兼容的 API 服务进行评测',
                'params': ['api_url', 'api_key']
            },
            'openai_api': {
                'name': 'openai_api',
                'display_name': 'OpenAI API 兼容',
                'description': '调用 OpenAI 兼容的 API 服务进行评测',
                'params': ['api_url', 'api_key']
            },
            'anthropic_api': {
                'name': 'anthropic_api',
                'display_name': 'Anthropic API',
                'description': '调用 Anthropic Claude API 进行评测',
                'params': ['api_url', 'api_key']
            },
            'modelscope': {
                'name': 'llm_ckpt',
                'display_name': 'ModelScope 本地模型',
                'description': '使用 ModelScope 加载本地模型进行评测',
                'params': ['model', 'model_args']
            },
            'llm_ckpt': {
                'name': 'llm_ckpt',
                'display_name': 'ModelScope 本地模型',
                'description': '使用 ModelScope 加载本地模型进行评测',
                'params': ['model', 'model_args']
            },
            'mock_llm': {
                'name': 'mock_llm',
                'display_name': 'Mock LLM',
                'description': '用于测试链路的模拟 LLM',
                'params': []
            },
            'text2image': {
                'name': 'text2image',
                'display_name': '图像生成模型',
                'description': '评测文本到图像生成能力',
                'params': ['model']
            },
            'image_editing': {
                'name': 'image_editing',
                'display_name': '图像编辑模型',
                'description': '评测图像编辑能力',
                'params': ['model']
            },
        }

        deduped = {}
        for key in self.model_apis:
            info = model_type_info.get(key, {
                'name': key,
                'display_name': key,
                'description': 'EvalScope 注册的模型接口类型',
                'params': []
            })
            deduped[info['name']] = info
        return list(deduped.values())

    def get_eval_engines(self) -> List[Dict[str, Any]]:
        return [
            {'name': 'Native', 'display_name': 'Native', 'description': 'EvalScope 原生评测引擎'},
            {'name': 'OpenCompass', 'display_name': 'OpenCompass', 'description': 'OpenCompass 文本评测引擎'},
            {'name': 'VLMEvalKit', 'display_name': 'VLMEvalKit', 'description': 'VLMEvalKit 多模态评测引擎'},
            {'name': 'RAGEval', 'display_name': 'RAG-Eval', 'description': 'RAG 检索增强评测引擎'},
        ]


catalog_service = CatalogService()
