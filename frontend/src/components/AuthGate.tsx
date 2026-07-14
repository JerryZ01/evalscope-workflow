import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Spin, Typography } from 'antd';
import { LockOutlined } from '@ant-design/icons';

import { authApi } from '@/api/auth';


interface AuthGateProps {
  children: React.ReactNode;
}


const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [required, setRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = async () => {
    try {
      const status = await authApi.status();
      setRequired(status.required);
      setAuthenticated(status.authenticated);
      setError(null);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : '无法检查认证状态');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    checkStatus();
    const requireAuth = () => {
      setRequired(true);
      setAuthenticated(false);
    };
    window.addEventListener('evalscope-auth-required', requireAuth);
    return () => window.removeEventListener('evalscope-auth-required', requireAuth);
  }, []);

  const handleLogin = async ({ token }: { token: string }) => {
    setSubmitting(true);
    setError(null);
    try {
      const status = await authApi.login(token);
      setRequired(status.required);
      setAuthenticated(status.authenticated);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="auth-page">
        <Spin size="large" />
      </div>
    );
  }

  if (!required || authenticated) {
    return children;
  }

  return (
    <div className="auth-page">
      <Card className="auth-card">
        <LockOutlined className="auth-icon" />
        <Typography.Title level={3}>EvalScope Workflow</Typography.Title>
        <Typography.Text type="secondary">请输入平台访问令牌</Typography.Text>
        {error && <Alert type="error" showIcon message={error} />}
        <Form layout="vertical" onFinish={handleLogin} requiredMark={false}>
          <Form.Item
            name="token"
            label="访问令牌"
            rules={[{ required: true, message: '请输入访问令牌' }]}
          >
            <Input.Password autoFocus autoComplete="current-password" prefix={<LockOutlined />} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={submitting} block>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  );
};

export default AuthGate;
