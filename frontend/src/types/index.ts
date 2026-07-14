// 模型管理类型
export interface ManagedModel {
  id: number;
  name: string;
  model_type: string;
  model_name: string;
  api_url?: string;
  has_api_key: boolean;
  generation_config: Record<string, any>;
  is_default: boolean;
  description?: string;
  is_active: boolean;
  use_count: number;
  created_at: string;
  updated_at: string;
}

export interface ManagedModelBrief {
  id: number;
  name: string;
  model_type: string;
  model_name: string;
  api_url?: string;
  is_default: boolean;
}

// 任务类型
export interface Task {
  id: number;
  task_uuid: string;
  name: string;
  description?: string;
  model_name: string;
  model_type: string;
  model_url?: string;
  has_model_key: boolean;
  generation_config: GenerationConfig;
  datasets: string[];
  dataset_args: Record<string, any>;
  limit?: number;
  eval_batch_size: number;
  engine?: string;
  use_cache?: string;  // 断点续测：指定之前的工作目录
  rerun_review?: boolean;  // 是否重新执行 review
  status: TaskStatus;
  progress: number;
  current_step?: string;
  results?: EvaluationResults;
  report_path?: string;
  logs?: string;
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
  duration?: number;
  error?: string;
  output_dir?: string;
}

export type TaskStatus = 'pending' | 'confirming' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowStatus {
  task_id: number;
  waiting_for_confirmation: boolean;
  next_step: string | null;
  current_step: string;
  config_summary: string;
  diagnosis: string;
  retry_count: number;
  eval_success: boolean | null;
  eval_score: number | null;
  eval_error: string | null;
}

export interface GenerationConfig {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  top_k?: number;
  stop?: string[];
  stream?: boolean;
}

export interface EvaluationResults {
  score: number;
  metrics: any[];
}

// 数据集类型
export interface Dataset {
  name: string;
  pretty_name?: string;
  description?: string;
  description_zh?: string;  // 中文 Markdown 描述
  tags: string[];
  subset_list: string[];
  few_shot_num: number;
  metric_list: string[];
  output_types: string[];
  need_sandbox?: boolean;  // 是否需要沙箱执行（编程类数据集）
  need_judge?: boolean;    // 是否需要 LLM 评判器（复杂答案类数据集）
}

// 模型类型
export interface ModelType {
  name: string;
  description?: string;
  config_schema: Record<string, any>;
}

// 指标类型
export interface Metric {
  name: string;
  description?: string;
  category?: string;
}

// 评测结果类型
export interface Report {
  name: string;
  dataset_name: string;
  dataset_pretty_name?: string;
  dataset_description?: string;
  model_name: string;
  score: number;
  metrics: MetricResult[];
  analysis: string;
}

export interface MetricResult {
  name: string;
  num: number;
  score: number;
  macro_score: number;
  categories: CategoryResult[];
}

export interface CategoryResult {
  name: string;
  num: number;
  score: number;
  macro_score: number;
  subsets: SubsetResult[];
}

export interface SubsetResult {
  name: string;
  score: number;
  num: number;
}

// 可视化数据类型
export interface VisualizationData {
  overview: {
    score: number;
    model: string;
    dataset: string;
    dataset_pretty_name?: string;
    total_samples: number;
    duration?: number;
  };
  radar: { metric: string; score: number }[];
  categories: { name: string; score: number; num: number }[];
  analysis?: string;
}
