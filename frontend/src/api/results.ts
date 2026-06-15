import client from './client';
import type { Report, VisualizationData } from '@/types';

// 评测结果 API
export const resultsApi = {
  // 获取任务评测结果
  getReport: (taskId: number) =>
    client.get<Report>(`/results/tasks/${taskId}/results`),

  // 获取可视化数据
  getVisualization: (taskId: number) =>
    client.get<VisualizationData>(`/results/tasks/${taskId}/visualization`),

  // 获取模型趋势
  getModelTrend: (modelName: string, dataset: string) =>
    client.get<{ model_name: string; dataset: string; runs: any[] }>(
      `/results/models/${modelName}/trend`,
      { params: { dataset } }
    ),

  // 对比模型
  compareModels: (modelNames: string[], dataset: string) =>
    client.get<{ dataset: string; models: any[] }>('/results/compare', {
      params: { model_names: modelNames.join(','), dataset },
    }),
};

// 评测执行 API
export const evalApi = {
  // 执行评测
  run: (taskId: number) =>
    client.post<{ message: string; task_id: number; status: string }>(`/eval/run/${taskId}`),

  // 取消评测
  cancel: (taskId: number) =>
    client.post<{ message: string; task_id: number }>(`/eval/cancel/${taskId}`),

  // 获取评测日志
  getLog: (taskId: number) =>
    client.get<{
      task_id: number;
      logs: string;
      status: string;
      current_step: string;
      progress: number;
      log_source?: string;
    }>(`/eval/log/${taskId}`),

  // 获取评测报告 HTML
  getReport: (taskId: number) =>
    client.get<{
      task_id: number;
      status: string;
      exists: boolean;
      html: string | null;
    }>(`/eval/report/${taskId}`),
};