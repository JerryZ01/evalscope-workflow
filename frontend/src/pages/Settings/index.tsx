import { useState, useEffect } from 'react';
import { Card, Form, Input, Button, Switch, Space, message, Divider, Alert, Spin } from 'antd';
import { settingsApi } from '@/api/settings';
import type { Settings } from '@/api/settings';
import { FolderOutlined, RocketOutlined, ReloadOutlined, SaveOutlined, SettingOutlined } from '@ant-design/icons';
import PageHeader from '@/components/common/PageHeader';

const SettingsPage: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(true);
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setInitLoading(true);
    try {
      const data = await settingsApi.get();
      console.log('加载设置成功:', data);
      setSettings(data);
      // 显式设置表单字段值
      form.setFieldsValue({
        output_dir: data.output_dir,
        dataset_dir: data.dataset_dir,
        use_cache: data.use_cache,
        debug: data.debug,
      });
    } catch (error: any) {
      console.error('Failed to load settings:', error);
      message.error(error.message || '加载设置失败');
    } finally {
      setInitLoading(false);
    }
  };

  const handleSubmit = async () => {
    try {
      setLoading(true);
      const values = await form.validateFields();
      console.log('保存设置:', values);
      const updated = await settingsApi.update(values);
      message.success('设置已保存');
      setSettings(updated);
      form.setFieldsValue(updated);
    } catch (error: any) {
      console.error('保存设置失败:', error);
      message.error(error.message || '保存设置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    try {
      setLoading(true);
      const reset = await settingsApi.reset();
      message.success('设置已重置为默认值');
      setSettings(reset);
      form.setFieldsValue(reset);
    } catch (error: any) {
      console.error('重置设置失败:', error);
      message.error(error.message || '重置设置失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      <PageHeader
        icon={<SettingOutlined />}
        title="系统设置"
        subtitle="评测任务执行环境与全局开关"
      />

      <Alert
        message="配置说明"
        description="这些设置将影响评测任务的执行路径和行为。修改后请谨慎操作。"
        type="info"
        showIcon
        style={{
          marginBottom: 24,
          borderRadius: 12,
          border: 'none',
          background: 'linear-gradient(135deg, #e6f7ff 0%, #f0f5ff 100%)',
        }}
      />

      <Card
        style={{
          borderRadius: 16,
          border: 'none',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
        }}
        loading={initLoading}
      >
        <Form
          form={form}
          layout="vertical"
        >
          <div style={{ marginBottom: 24 }}>
            <h3 style={{
              fontSize: 16,
              fontWeight: 600,
              color: '#1a1a2e',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 20
            }}>
              <FolderOutlined style={{ color: '#1890ff' }} />
              目录设置
            </h3>

            <Form.Item
              name="output_dir"
              label="评测结果输出目录"
              rules={[{ required: true, message: '请输入输出目录' }]}
              tooltip="评测结果、日志和报告将保存在此目录下"
            >
              <Input
                placeholder="./outputs"
                style={{
                  borderRadius: 10,
                  height: 44,
                }}
              />
            </Form.Item>

            <Form.Item
              name="dataset_dir"
              label="数据集目录"
              rules={[{ required: true, message: '请输入数据集目录' }]}
              tooltip="自定义数据集的存放路径"
            >
              <Input
                placeholder="./data/datasets"
                style={{
                  borderRadius: 10,
                  height: 44,
                }}
              />
            </Form.Item>
          </div>

          <Divider style={{ margin: '24px 0' }} />

          <div style={{ marginBottom: 24 }}>
            <h3 style={{
              fontSize: 16,
              fontWeight: 600,
              color: '#1a1a2e',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 20
            }}>
              <RocketOutlined style={{ color: '#9254de' }} />
              执行设置
            </h3>

            <Form.Item
              name="use_cache"
              label="启用缓存"
              valuePropName="checked"
              tooltip="启用后，相同配置的评测任务会复用之前的推理结果"
            >
              <Switch
                checkedChildren="启用"
                unCheckedChildren="禁用"
                style={{
                  borderRadius: 20,
                }}
              />
            </Form.Item>

            <Form.Item
              name="debug"
              label="调试模式"
              valuePropName="checked"
              tooltip="启用后，会输出更详细的日志信息"
            >
              <Switch
                checkedChildren="启用"
                unCheckedChildren="禁用"
                style={{
                  borderRadius: 20,
                }}
              />
            </Form.Item>
          </div>

          <Divider style={{ margin: '24px 0' }} />

          <Form.Item>
            <Space size={12}>
              <Button
                type="primary"
                size="large"
                icon={<SaveOutlined />}
                onClick={handleSubmit}
                loading={loading}
              >
                保存设置
              </Button>
              <Button
                size="large"
                icon={<ReloadOutlined />}
                onClick={handleReset}
                loading={loading}
              >
                重置为默认
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .ant-form-item-label > label {
          font-weight: 600;
          color: #1a1a2e;
        }
      `}</style>
    </div>
  );
};

export default SettingsPage;