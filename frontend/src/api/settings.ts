/**
 * Settings API - 系统设置
 *
 * 注意：client.ts 已经设置 baseURL='/api'，且响应拦截器已经返回 response.data
 * 所以这里不需要加 /api 前缀，也不需要再访问 .data
 */
import client from './client';

export interface Settings {
  output_dir: string;
  dataset_dir: string;
  use_cache: boolean;
  debug: boolean;
}

export const settingsApi = {
  /**
   * 获取系统设置
   */
  get: (): Promise<Settings> =>
    client.get<Settings>('/settings') as unknown as Promise<Settings>,

  /**
   * 更新系统设置
   */
  update: (settings: Partial<Settings>): Promise<Settings> =>
    client.post<Settings>('/settings', settings) as unknown as Promise<Settings>,

  /**
   * 重置设置为默认值
   */
  reset: (): Promise<Settings> =>
    client.post<Settings>('/settings/reset') as unknown as Promise<Settings>,
};