import axios from 'axios';

const client = axios.create({
  baseURL: '/api',
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器
client.interceptors.request.use(
  (config) => {
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器
client.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
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

export default client;