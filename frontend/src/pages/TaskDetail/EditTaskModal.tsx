import { useState, useEffect } from 'react';
import {
  Modal, Form, Input, Select, InputNumber, Button, Space, Divider, message, Spin, Switch,
} from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { useTaskStore } from '@/stores';
import { workflowApi } from '@/api/workflow';
import { modelApi } from '@/api/models';
import { catalogApi } from '@/api/catalog';
import type { ManagedModelBrief } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  taskId: string;
}

interface Engine {
  name: string;
  description: string;
}

const EditTaskModal: React.FC<Props> = ({ open, onClose, taskId }) => {
  const [form] = Form.useForm();
  const { currentTask, fetchTask, updateTask } = useTaskStore();
  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(false);
  const [managedModels, setManagedModels] = useState<ManagedModelBrief[]>([]);
  const [selectedManagedModel, setSelectedManagedModel] = useState<number | null>(null);
  const [engines, setEngines] = useState<Engine[]>([]);

  useEffect(() => {
    if (open) {
      setInitLoading(true);
      Promise.all([
        modelApi.listBrief().then(data => setManagedModels(data)).catch(() => {}),
        catalogApi.getEngines().then(data => setEngines(data.engines)).catch(() => {}),
      ]).finally(() => setInitLoading(false));
    }
  }, [open]);

  useEffect(() => {
    if (open && currentTask) {
      const genConfig = currentTask.generation_config || {};
      form.setFieldsValue({
        name: currentTask.name,
        description: currentTask.description,
        model_type: currentTask.model_type,
        model_name: currentTask.model_name,
        model_url: currentTask.model_url || '',
        model_key: '',
        stream: !!genConfig.stream,
        limit: currentTask.limit,
        eval_batch_size: currentTask.eval_batch_size || 1,
        engine: currentTask.engine || 'native',
      });
    }
  }, [open, currentTask, form]);

  const handleSelectManagedModel = (modelId: number) => {
    setSelectedManagedModel(modelId);
    const model = managedModels.find(m => m.id === modelId);
    if (model) {
      form.setFieldsValue({
        model_type: model.model_type,
        model_name: model.model_name,
        model_url: model.api_url || undefined,
        model_key: undefined,
      });
    }
  };

  const buildUpdateParams = (values: any) => ({
    name: values.name,
    description: values.description,
    model_name: values.model_name,
    model_type: values.model_type || 'openai_api',
    model_url: values.model_url,
    ...(values.model_key ? { model_key: values.model_key } : {}),
    generation_config: {
      stream: !!values.stream,
    },
    datasets: currentTask?.datasets,
    limit: values.limit,
    eval_batch_size: values.eval_batch_size || 1,
    engine: values.engine || 'native',
  });

  const handleSaveOnly = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await updateTask(Number(taskId), buildUpdateParams(values));
      await fetchTask(Number(taskId));
      message.success('参数已保存');
      onClose();
    } catch (error: any) {
      const errMsg = error?.response?.data?.detail || error?.message || String(error) || '保存失败';
      message.error(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAndRun = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await updateTask(Number(taskId), buildUpdateParams(values));
      await workflowApi.start(Number(taskId));
      await fetchTask(Number(taskId));
      message.success('参数已保存，工作流已启动');
      onClose();
    } catch (error: any) {
      const errMsg = error?.response?.data?.detail || error?.message || String(error) || '操作失败';
      message.error(errMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="编辑任务参数"
      open={open}
      onCancel={onClose}
      footer={null}
      width={520}
      destroyOnClose
    >
      {initLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : (
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '请输入任务名称' }]}>
            <Input placeholder="任务名称" />
          </Form.Item>

          <Divider style={{ margin: '12px 0' }}>模型配置</Divider>

          {managedModels.length > 0 && (
            <Form.Item label="选择已管理模型">
              <Select
                placeholder="快速选择已管理模型"
                allowClear
                value={selectedManagedModel}
                onChange={handleSelectManagedModel}
                options={managedModels.map(m => ({
                  label: m.name + (m.is_default ? ' ⭐' : ''),
                  value: m.id,
                }))}
              />
            </Form.Item>
          )}

          <Space style={{ display: 'flex' }} size={12}>
            <Form.Item name="model_type" label="模型类型" style={{ flex: 1 }} rules={[{ required: true }]}>
              <Select
                placeholder="模型类型"
                options={[
                  { label: 'OpenAI API', value: 'openai_api' },
                  { label: 'LLM Checkpoint', value: 'llm_ckpt' },
                  { label: 'Text2Image', value: 'text2image' },
                  { label: 'Mock', value: 'mock' },
                ]}
              />
            </Form.Item>
            <Form.Item name="model_name" label="模型名称" style={{ flex: 2 }} rules={[{ required: true, message: '请输入模型名称' }]}>
              <Input placeholder="例如: gpt-4, qwen-72b" />
            </Form.Item>
          </Space>

          <Form.Item name="model_url" label="API URL (可选)">
            <Input placeholder="例如: https://ark.cn-beijing.volces.com/api/v3" />
          </Form.Item>

          <Form.Item name="model_key" label="替换 API Key（可选）">
            <Input.Password placeholder="留空则保留现有密钥" />
          </Form.Item>

          <Divider style={{ margin: '12px 0' }}>评测参数</Divider>

          <Space style={{ display: 'flex' }} size={12}>
            <Form.Item name="engine" label="评测引擎" style={{ flex: 1 }}>
              <Select
                placeholder="评测引擎"
                options={engines.map(e => ({
                  label: `${e.name} - ${e.description}`,
                  value: e.name,
                }))}
              />
            </Form.Item>
            <Form.Item name="limit" label="样本数限制" style={{ flex: 1 }}>
              <InputNumber min={1} max={10000} placeholder="留空则全部" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="eval_batch_size" label="评测批次" style={{ flex: 1 }}>
              <InputNumber min={1} max={100} style={{ width: '100%' }} />
            </Form.Item>
          </Space>

          <Divider style={{ margin: '12px 0' }}>生成配置</Divider>

          <div
            style={{
              background: 'linear-gradient(135deg, #f7f9fc 0%, #f0f5ff 100%)',
              border: '1px solid #e6ebf5',
              borderRadius: 10,
              padding: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1f2d3d', display: 'flex', alignItems: 'center', gap: 6 }}>
                <ThunderboltOutlined style={{ color: '#9254de' }} />
                流式响应 (stream)
              </div>
              <div style={{ fontSize: 12, color: '#86909c', marginTop: 2, lineHeight: 1.5 }}>
                其它生成参数 (Temperature / Max Tokens / Top P) 继承自模型管理中的配置
              </div>
            </div>
            <Form.Item name="stream" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch checkedChildren="ON" unCheckedChildren="OFF" />
            </Form.Item>
          </div>

          <div style={{ textAlign: 'right', marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
            <Space>
              <Button onClick={onClose}>取消</Button>
              <Button onClick={handleSaveOnly} loading={loading}>
                仅保存
              </Button>
              <Button type="primary" onClick={handleSaveAndRun} loading={loading}>
                保存并重新执行
              </Button>
            </Space>
          </div>
        </Form>
      )}
    </Modal>
  );
};

export default EditTaskModal;
