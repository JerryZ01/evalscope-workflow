export interface AuthStatus {
  required: boolean;
  authenticated: boolean;
}

async function parseResponse(response: Response): Promise<AuthStatus> {
  const data = await response.json().catch(() => ({ detail: '认证请求失败' }));
  if (!response.ok) {
    throw new Error(data.detail || '认证请求失败');
  }
  return data;
}

export const authApi = {
  status: async (): Promise<AuthStatus> => {
    const response = await fetch('/api/auth/status', { credentials: 'same-origin' });
    return parseResponse(response);
  },

  login: async (token: string): Promise<AuthStatus> => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    return parseResponse(response);
  },

  logout: async (): Promise<AuthStatus> => {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    });
    return parseResponse(response);
  },
};
