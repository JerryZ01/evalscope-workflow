import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Steps, Card, Form, Input, Select, InputNumber, Button, Space, Checkbox, message, Divider, Spin, Switch } from 'antd';
import { ArrowLeftOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useCatalogStore, useTaskStore } from '@/stores';
import { workflowApi } from '@/api/workflow';
import { modelApi } from '@/api/models';
import { catalogApi } from '@/api/catalog';
import type { ManagedModelBrief } from '@/types';

const TaskEdit: React.FC = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const { datasets, fetchDatasets } = useCatalogStore();
  const { currentTask, fetchTask, updateTask } = useTaskStore();

  const [currentStep, setCurrentStep] = useState(0);
  const [selectedDatasets, setSelectedDatasets] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(true);
  const [managedModels, setManagedModels] = useState<ManagedModelBrief[]>([]);
  const [selectedManagedModel, setSelectedManagedModel] = useState<number | null>(null);
  const [engines, setEngines] = useState<{name: string; description: string}[]>([]);

  // 加载任务数据和初始化
  useEffect(() => {
    const init = async () => {
      if (!taskId) return;

      setInitLoading(true);
      try {
        // 并行加载数据
        await Promise.all([
          fetchTask(Number(taskId)),
          fetchDatasets({ limit: 100 }),
          modelApi.listBrief().then(data => setManagedModels(data)).catch(console.error),
          catalogApi.getEngines().then(data => setEngines(data.engines)).catch(console.error),
        ]);
      } finally {
        setInitLoading(false);
      }
    };

    init();
  }, [taskId]);

  // 当任务数据加载完成后，填充表单
  useEffect(() => {
    if (currentTask) {
      const genConfig = currentTask.generation_config || {};
      form.setFieldsValue({
        name: currentTask.name,
        description: currentTask.description,
        model_name: currentTask.model_name,
        model_type: currentTask.model_type,
        model_url: currentTask.model_url,
        generation_config: genConfig,
        stream: !!genConfig.stream,
      });
      setSelectedDatasets(currentTask.datasets || []);
    }
  }, [currentTask, form]);

  // 选择已管理模型时自动填充配置
  const handleSelectManagedModel = (modelId: number) => {
    setSelectedManagedModel(modelId);
    const model = managedModels.find(m => m.id === modelId);
    if (model) {
      form.setFieldsValue({
        model_type: model.model_type,
        model_name: model.model_name,
        model_url: model.api_url || undefined,
      });
    }
  };

  const handleNext = async () => {
    if (currentStep === 0) {
      const values = await form.validateFields(['model_name', 'model_type']);
      if (!values.model_name) {
        message.error('请选择或输入模型名称');
        return;
      }
    }
    setCurrentStep(currentStep + 1);
  };

  const handlePrev = () => {
    setCurrentStep(currentStep - 1);
  };

  // 仅保存（不运行）
  const handleSaveOnly = async () => {
    try {
      const values = await form.validateFields(['name', 'model_name', 'model_type']);

      if (!selectedDatasets || selectedDatasets.length === 0) {
        message.error('请至少选择一个数据集');
        return;
      }

      if (!values.model_name) {
        message.error('请输入模型名称');
        return;
      }

      setLoading(true);

      const updateParams = {
        name: values.name,
        description: values.description,
        model_name: values.model_name,
        model_type: values.model_type || 'openai_api',
        model_url: values.model_url,
        generation_config: {
          stream: !!values.stream,
        },
        datasets: selectedDatasets,
        dataset_args: values.dataset_args,
        limit: values.limit,
        eval_batch_size: values.eval_batch_size || 1,
        engine: values.engine || 'native',
      };

      await updateTask(Number(taskId), updateParams);
      message.success('任务参数已保存');
      navigate(`/tasks/${taskId}`);
    } catch (error: any) {
      console.error('Update task error:', error);
      const errMsg = error?.response?.data?.detail || error?.message || String(error) || '保存失败';
      message.error(errMsg);
    } finally {
      setLoading(false);
    }
  };

  // 保存并运行
  const handleSaveAndRun = async () => {
    try {
      const values = await form.validateFields(['name', 'model_name', 'model_type']);

      if (!selectedDatasets || selectedDatasets.length === 0) {
        message.error('请至少选择一个数据集');
        return;
      }

      if (!values.model_name) {
        message.error('请输入模型名称');
        return;
      }

      setLoading(true);

      // 先保存参数
      const updateParams = {
        name: values.name,
        description: values.description,
        model_name: values.model_name,
        model_type: values.model_type || 'openai_api',
        model_url: values.model_url,
        generation_config: {
          stream: !!values.stream,
        },
        datasets: selectedDatasets,
        dataset_args: values.dataset_args,
        limit: values.limit,
        eval_batch_size: values.eval_batch_size || 1,
        engine: values.engine || 'native',
      };

      await updateTask(Number(taskId), updateParams);

      // 重试任务（会重置状态为 pending）
      try {
        await useTaskStore.getState().retryTask(Number(taskId));
      } catch {
        // 如果重试失败，可能状态不支持，直接启动
      }

      // 启动任务
      await workflowApi.start(Number(taskId));

      message.success('任务已保存并启动');
      navigate(`/tasks/${taskId}`);
    } catch (error: any) {
      console.error('Save and run error:', error);
      const errMsg = error?.response?.data?.detail || error?.message || String(error) || '保存并启动失败';
      message.error(errMsg);
    } finally {
      setLoading(false);
    }
  };

  if (initLoading) {
    return (
      <div style={{ textAlign: 'center', marginTop: 100 }}>
        <Spin size="large" tip="加载任务数据..." />
      </div>
    );
  }

  if (!currentTask) {
    return (
      <div style={{ textAlign: 'center', marginTop: 100 }}>
        <p>任务不存在</p>
        <Button onClick={() => navigate('/tasks')}>返回列表</Button>
      </div>
    );
  }

  const steps = [
    {
      title: '选择模型',
      content: (
        <Form form={form} layout="vertical">
          {/* 选择已管理的模型 */}
          {managedModels.length > 0 && (
            <>
              <Form.Item label="选择已管理的模型">
                <Select
                  placeholder="从已管理的模型中选择"
                  allowClear
                  value={selectedManagedModel}
                  onChange={handleSelectManagedModel}
                  options={managedModels.map(m => ({
                    label: (
                      <Space>
                        <span>{m.name}</span>
                        {m.is_default && <span style={{ color: '#faad14' }}>⭐ 默认</span>}
                      </Space>
                    ),
                    value: m.id
                  }))}
                />
              </Form.Item>
              <Divider>或手动输入</Divider>
            </>
          )}

          <Form.Item
            name="model_type"
            label="模型类型"
          >
            <Select
              placeholder="选择模型类型"
              options={[
                { label: 'OpenAI API', value: 'openai_api' },
                { label: 'LLM Checkpoint', value: 'llm_ckpt' },
                { label: 'Text2Image', value: 'text2image' },
                { label: 'Mock', value: 'mock' },
              ]}
              onChange={() => form.setFieldValue('model_url', undefined)}
            />
          </Form.Item>

          <Form.Item
            name="model_name"
            label="模型名称"
            rules={[{ required: true, message: '请输入模型名称' }]}
          >
            <Input placeholder="例如: gpt-4, qwen-72b, etc." />
          </Form.Item>

          <Form.Item name="model_url" label="API URL (可选)">
            <Input placeholder="例如: https://api.openai.com/v1" />
          </Form.Item>

          <Form.Item name="model_key" label="API Key (可选)">
            <Input.Password placeholder="API Key" />
          </Form.Item>
        </Form>
      ),
    },
    {
      title: '选择数据集',
      content: (
        <div>
          <Input
            placeholder="搜索数据集..."
            style={{ marginBottom: 16 }}
            onChange={(e) => fetchDatasets({ search: e.target.value, limit: 100 })}
          />
          <Checkbox.Group
            value={selectedDatasets}
            onChange={(values) => setSelectedDatasets(values as string[])}
            style={{ width: '100%' }}
          >
            <div style={{ maxHeight: 400, overflow: 'auto' }}>
              {datasets.map((ds) => (
                <Checkbox
                  key={ds.name}
                  value={ds.name}
                  style={{ display: 'block', marginBottom: 8 }}
                >
                  <span style={{ fontWeight: 500 }}>{ds.pretty_name || ds.name}</span>
                  {ds.description && (
                    <span style={{ color: '#8c8c8c', marginLeft: 8 }}>
                      - {ds.description.substring(0, 50)}...
                    </span>
                  )}
                </Checkbox>
              ))}
            </div>
          </Checkbox.Group>
          <div style={{ marginTop: 16 }}>
            已选择: {selectedDatasets.length} 个数据集
          </div>
        </div>
      ),
    },
    {
      title: '配置参数',
      content: (
        <Form form={form} layout="vertical">
          <Form.Item name="engine" label="评测引擎">
            <Select
              placeholder="选择评测引擎"
              options={engines.map(e => ({
                label: `${e.name} - ${e.description}`,
                value: e.name
              }))}
            />
          </Form.Item>

          <Form.Item name="limit" label="样本数限制 (可选)">
            <InputNumber min={1} max={10000} placeholder="留空则评测全部" style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item name="eval_batch_size" label="评测批次" initialValue={1}>
            <InputNumber min={1} max={100} style={{ width: '100%' }} />
          </Form.Item>

          <div
            style={{
              background: 'linear-gradient(135deg, #f7f9fc 0%, #f0f5ff 100%)',
              border: '1px solid #e6ebf5',
              borderRadius: 12,
              padding: 16,
              marginTop: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1f2d3d', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ThunderboltOutlined style={{ color: '#9254de' }} />
                  流式响应 (stream)
                </div>
                <div style={{ fontSize: 12, color: '#86909c', marginTop: 4, lineHeight: 1.5 }}>
                  开启后，本任务调用模型时使用 SSE 流式接口；其它生成参数（Temperature / Max Tokens / Top P 等）将继承所选模型在<strong>「模型管理」</strong>中保存的配置。
                </div>
              </div>
              <Form.Item name="stream" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Switch checkedChildren="ON" unCheckedChildren="OFF" />
              </Form.Item>
            </div>
          </div>
        </Form>
      ),
    },
    {
      title: '确认保存',
      content: (
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="任务名称"
            rules={[{ required: true, message: '请输入任务名称' }]}
          >
            <Input placeholder="例如: GPT-4 MMLU 评测" />
          </Form.Item>

          <Form.Item name="description" label="任务描述 (可选)">
            <Input.TextArea rows={3} placeholder="任务的简单描述..." />
          </Form.Item>

          <Card size="small" style={{ marginTop: 16, background: '#fafafa' }}>
            <h4>配置摘要</h4>
            <p>模型: {form.getFieldValue('model_name')}</p>
            <p>模型类型: {form.getFieldValue('model_type')}</p>
            <p>数据集: {selectedDatasets.join(', ')}</p>
            <p>样本数限制: {form.getFieldValue('limit') || '全部'}</p>
          </Card>
        </Form>
      ),
    },
  ];

  return (
    <div>
      <Button
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate(`/tasks/${taskId}`)}
        style={{ marginBottom: 16 }}
      >
        返回任务详情
      </Button>

      <h1 style={{ marginBottom: 24 }}>编辑任务参数</h1>

      <Card>
        <Steps current={currentStep} items={steps.map((s) => ({ title: s.title }))} />

        <div style={{ marginTop: 32, minHeight: 300 }}>
          {steps[currentStep].content}
        </div>

        <div style={{ marginTop: 24, textAlign: 'right' }}>
          <Space>
            {currentStep > 0 && (
              <Button onClick={handlePrev}>上一步</Button>
            )}
            {currentStep < steps.length - 1 ? (
              <Button type="primary" onClick={handleNext}>
                下一步
              </Button>
            ) : (
              <>
                <Button onClick={handleSaveOnly} loading={loading}>
                  仅保存
                </Button>
                <Button type="primary" onClick={handleSaveAndRun} loading={loading}>
                  保存并运行
                </Button>
              </>
            )}
          </Space>
        </div>
      </Card>
    </div>
  );
};

export default TaskEdit;
