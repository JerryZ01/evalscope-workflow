import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';

const axiosClient = axios.create({
  baseURL: '/api',
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器
axiosClient.interceptors.request.use(
  (config) => {
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器
axiosClient.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    if (error.response?.status === 401) {
      window.dispatchEvent(new Event('evalscope-auth-required'));
    }
    const detail = error.response?.data?.detail;
    let message = '请求失败';
    if (detail) {
      if (typeof detail === 'string') {
        message = detail;
      } else if (Array.isArray(detail)) {
        // Pydantic validation error array
        message = detail.map((d: any) => d.msg || JSON.stringify(d)).join(', ');
      } else if (typeof detail === 'object') {
        message = detail.msg || JSON.stringify(detail);
      }
    } else {
      message = error.message || '请求失败';
    }
    console.error('API Error:', message);
    return Promise.reject(new Error(message));
  }
);

interface ApiClient {
  get<T>(url: string, config?: AxiosRequestConfig): Promise<T>;
  post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>;
  patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>;
  put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>;
  delete<T>(url: string, config?: AxiosRequestConfig): Promise<T>;
}

const client = axiosClient as unknown as ApiClient;

export default client;
