import client from './client';
import type { Dataset, ModelType, Metric } from '@/types';

// 目录信息 API
export const catalogApi = {
  // 获取数据集列表
  getDatasets: (params?: {
    search?: string;
    tag?: string;
    skip?: number;
    limit?: number;
  }) =>
    client.get<{ total: number; datasets: Dataset[] }>('/catalog/datasets', { params }),

  // 获取数据集详情
  getDataset: (name: string) =>
    client.get<Dataset>(`/catalog/datasets/${name}`),

  // 获取模型类型列表
  getModels: () =>
    client.get<{ total: number; models: ModelType[] }>('/catalog/models'),

  // 获取模型类型详情
  getModel: (name: string) =>
    client.get<ModelType>(`/catalog/models/${name}`),

  // 获取指标列表
  getMetrics: (params?: { category?: string }) =>
    client.get<{ total: number; metrics: Metric[] }>('/catalog/metrics', { params }),

  // 获取评测引擎列表
  getEngines: () =>
    client.get<{ total: number; engines: any[] }>('/catalog/engines'),

  // 获取评测引擎详情
  getEngine: (name: string) =>
    client.get<any>(`/catalog/engines/${name}`),
};