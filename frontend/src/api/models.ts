import client from './client';
import type { ManagedModel, ManagedModelBrief } from '@/types';

export interface CreateModelParams {
  name: string;
  model_type: string;
  model_name: string;
  api_url?: string;
  api_key?: string;
  generation_config?: Record<string, any>;
  description?: string;
  is_default?: boolean;
}

// 模型管理 API
export const modelApi = {
  // 获取模型列表
  list: (params?: { skip?: number; limit?: number; active_only?: boolean }) =>
    client.get<{ total: number; models: ManagedModel[] }>('/models', { params }),

  // 获取简要模型列表（用于下拉选择）
  listBrief: (active_only?: boolean) =>
    client.get<ManagedModelBrief[]>('/models/brief', { params: { active_only } }),

  // 获取默认模型
  getDefault: () =>
    client.get<ManagedModelBrief | null>('/models/default'),

  // 获取模型详情
  get: (modelId: number) =>
    client.get<ManagedModel>(`/models/${modelId}`),

  // 创建模型
  create: (params: CreateModelParams) =>
    client.post<ManagedModel>('/models', params),

  // 更新模型
  update: (modelId: number, data: Partial<CreateModelParams>) =>
    client.patch<ManagedModel>(`/models/${modelId}`, data),

  // 删除模型
  delete: (modelId: number) =>
    client.delete<void>(`/models/${modelId}`),

  // 设为默认
  setDefault: (modelId: number) =>
    client.post<ManagedModel>(`/models/${modelId}/set-default`),

  // 记录使用
  recordUsage: (modelId: number) =>
    client.post<ManagedModel>(`/models/${modelId}/use`),

  // 测试连接（可选覆盖 stream；不传则使用模型 generation_config.stream）
  test: (modelId: number, stream?: boolean) =>
    client.post<ConnectionTestResult>(`/models/${modelId}/test`, undefined, {
      params: stream === undefined ? {} : { stream },
    }),
};

export interface ConnectionTestRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  payload: Record<string, any>;
}

export interface ConnectionTestResponse {
  status_code: number;
  headers: Record<string, string>;
  body?: any;
  raw?: string | null;
  content?: string;
  chunks_count?: number;
}

export interface ConnectionTestResult {
  success: boolean;
  latency_ms: number;
  stream: boolean;
  request: ConnectionTestRequest | null;
  response: ConnectionTestResponse | null;
  error: string | null;
}