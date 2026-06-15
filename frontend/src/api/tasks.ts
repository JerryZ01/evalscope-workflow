import client from './client';
import type { Task, TaskStatus } from '@/types';

export interface CreateTaskParams {
  name: string;
  description?: string;
  model_name: string;
  model_type: string;
  model_url?: string;
  model_key?: string;
  generation_config: Record<string, any>;
  datasets: string[];
  dataset_args?: Record<string, any>;
  limit?: number;
  eval_batch_size?: number;
}

export interface TaskListParams {
  skip?: number;
  limit?: number;
  status?: TaskStatus;
}

export interface UpdateTaskParams {
  name?: string;
  description?: string;
  model_name?: string;
  model_type?: string;
  model_url?: string;
  model_key?: string;
  generation_config?: Record<string, any>;
  datasets?: string[];
  dataset_args?: Record<string, any>;
  limit?: number;
  eval_batch_size?: number;
  engine?: string;
}

// 任务管理 API
export const taskApi = {
  // 创建任务
  create: (params: CreateTaskParams) =>
    client.post<{ id: number; name: string; status: TaskStatus; message: string }>('/tasks', params),

  // 获取任务列表
  list: (params?: TaskListParams) =>
    client.get<Task[]>('/tasks', { params }),

  // 获取任务详情
  get: (taskId: number) =>
    client.get<Task>(`/tasks/${taskId}`),

  // 更新任务
  update: (taskId: number, data: UpdateTaskParams) =>
    client.patch<Task>(`/tasks/${taskId}`, data),

  // 删除任务
  delete: (taskId: number) =>
    client.delete<{ id: number; message: string }>(`/tasks/${taskId}`),

  // 启动任务
  start: (taskId: number) =>
    client.post<{ id: number; status: TaskStatus; message: string }>(`/tasks/${taskId}/start`),

  // 停止任务
  stop: (taskId: number) =>
    client.post<{ id: number; status: TaskStatus; message: string }>(`/tasks/${taskId}/stop`),

  // 暂停任务
  pause: (taskId: number) =>
    client.post<{ id: number; status: TaskStatus; message: string }>(`/tasks/${taskId}/pause`),

  // 恢复任务
  resume: (taskId: number) =>
    client.post<{ id: number; status: TaskStatus; message: string }>(`/tasks/${taskId}/resume`),

  // 重试任务
  retry: (taskId: number) =>
    client.post<{ id: number; status: TaskStatus; message: string }>(`/tasks/${taskId}/retry`),

  // 获取任务状态
  getStatus: (taskId: number) =>
    client.get<{ id: number; status: TaskStatus; message: string }>(`/tasks/${taskId}/status`),
};