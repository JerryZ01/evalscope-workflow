import client from './client';
import type { WorkflowStatus } from '@/types';

export const workflowApi = {
  start: (taskId: number) =>
    client.post<{ status: string; task_id: number; message: string }>(`/workflow/${taskId}/start`),

  getStatus: (taskId: number) =>
    client.get<WorkflowStatus>(`/workflow/${taskId}/status`),

  confirm: (taskId: number, modifications?: Record<string, any>) =>
    client.post<{ status: string; task_id: number; message: string }>(`/workflow/${taskId}/confirm`, {
      approved: true,
      modifications: modifications || null,
    }),

  cancel: (taskId: number) =>
    client.post<{ status: string; task_id: number }>(`/workflow/${taskId}/cancel`),
};
