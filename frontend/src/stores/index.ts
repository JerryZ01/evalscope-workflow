import { create } from 'zustand';
import type { Task, TaskStatus, Dataset, ModelType, Metric } from '@/types';
import { taskApi, type CreateTaskParams, type UpdateTaskParams } from '@/api/tasks';
import { catalogApi } from '@/api/catalog';

interface TaskStore {
  // 任务列表
  tasks: Task[];
  currentTask: Task | null;
  loading: boolean;
  error: string | null;

  // 动作
  fetchTasks: (params?: { skip?: number; limit?: number; status?: TaskStatus }) => Promise<void>;
  fetchTask: (taskId: number) => Promise<void>;
  createTask: (params: CreateTaskParams) => Promise<number>;
  updateTask: (taskId: number, data: UpdateTaskParams) => Promise<void>;
  deleteTask: (taskId: number) => Promise<void>;
  startTask: (taskId: number) => Promise<void>;
  stopTask: (taskId: number) => Promise<void>;
  resumeTask: (taskId: number) => Promise<void>;
  retryTask: (taskId: number) => Promise<void>;
  setCurrentTask: (task: Task | null) => void;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  currentTask: null,
  loading: false,
  error: null,

  fetchTasks: async (params) => {
    set({ loading: true, error: null });
    try {
      const data = await taskApi.list(params);
      set({ tasks: data, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  fetchTask: async (taskId) => {
    set({ loading: true, error: null });
    try {
      const data = await taskApi.get(taskId);
      set({ currentTask: data, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  createTask: async (params) => {
    set({ loading: true, error: null });
    try {
      const response = await taskApi.create(params);
      // 刷新列表
      await get().fetchTasks();
      set({ loading: false });
      return response.id;
    } catch (error: any) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  updateTask: async (taskId, data) => {
    set({ loading: true, error: null });
    try {
      await taskApi.update(taskId, data);
      await get().fetchTask(taskId);
      await get().fetchTasks();
      set({ loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  deleteTask: async (taskId) => {
    set({ loading: true, error: null });
    try {
      await taskApi.delete(taskId);
      // 刷新列表
      await get().fetchTasks();
      set({ loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  startTask: async (taskId) => {
    try {
      await taskApi.start(taskId);
      await get().fetchTask(taskId);
      await get().fetchTasks();
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    }
  },

  stopTask: async (taskId) => {
    try {
      await taskApi.stop(taskId);
      await get().fetchTask(taskId);
      await get().fetchTasks();
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    }
  },

  resumeTask: async (taskId) => {
    try {
      await taskApi.resume(taskId);
      await get().fetchTask(taskId);
      await get().fetchTasks();
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    }
  },

  retryTask: async (taskId) => {
    try {
      await taskApi.retry(taskId);
      await get().fetchTask(taskId);
      await get().fetchTasks();
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    }
  },

  setCurrentTask: (task) => set({ currentTask: task }),
}));

interface CatalogStore {
  // 目录数据
  datasets: Dataset[];
  models: ModelType[];
  metrics: Metric[];
  loading: boolean;
  error: string | null;

  // 动作
  fetchDatasets: (params?: { search?: string; tag?: string; skip?: number; limit?: number }) => Promise<void>;
  fetchModels: () => Promise<void>;
  fetchMetrics: () => Promise<void>;
}

export const useCatalogStore = create<CatalogStore>((set) => ({
  datasets: [],
  models: [],
  metrics: [],
  loading: false,
  error: null,

  fetchDatasets: async (params) => {
    set({ loading: true, error: null });
    try {
      const data = await catalogApi.getDatasets(params);
      set({ datasets: data.datasets, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  fetchModels: async () => {
    set({ loading: true, error: null });
    try {
      const data = await catalogApi.getModels();
      set({ models: data.models, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  fetchMetrics: async () => {
    set({ loading: true, error: null });
    try {
      const data = await catalogApi.getMetrics();
      set({ metrics: data.metrics, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },
}));
