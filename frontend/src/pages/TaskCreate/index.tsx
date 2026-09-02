import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Steps, Card, Form, Input, Select, InputNumber, Button, Space, message, Divider, Tag, Tooltip, Alert, Switch } from 'antd';
import { PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useCatalogStore, useTaskStore } from '@/stores';
import PageHeader from '@/components/common/PageHeader';
import { modelApi } from '@/api/models';
import { catalogApi } from '@/api/catalog';
import type { ManagedModelBrief } from '@/types';

// ========== 类型定义 ==========
interface ModelConfig {
  model_name: string;
  model_type: string;
  model_url?: string;
  model_key?: string;
}

interface TaskFormData {
  name: string;
  description?: string;
  modelConfig: ModelConfig;
  datasets: string[];
  engine: string;
  limit?: number;
  eval_batch_size: number;
  stream: boolean;
}

const TaskCreate: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { datasets, fetchDatasets, models } = useCatalogStore();
  const { createTask } = useTaskStore();

  // ========== 状态管理（不依赖 Form） ==========
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [managedModels, setManagedModels] = useState<ManagedModelBrief[]>([]);
  const [engines, setEngines] = useState<{ name: string; description: string }[]>([]);

  // 表单数据（核心状态，完全由我们自己控制）
  const [formData, setFormData] = useState<TaskFormData>({
    name: '',
    description: '',
    modelConfig: {
      model_name: '',
      model_type: 'openai_api',
      model_url: undefined,
      model_key: undefined,
    },
    datasets: [],
    engine: 'native',
    limit: undefined,
    eval_batch_size: 3,
    stream: false,
  });

  const [selectedManagedModelId, setSelectedManagedModelId] = useState<number | null>(null);

  // ========== 初始化 ==========
  useEffect(() => {
    fetchDatasets({ limit: 100 });
    modelApi.listBrief().then(setManagedModels).catch(console.error);
    catalogApi.getEngines().then(data => setEngines(data.engines)).catch(console.error);
  }, []);

  // 支持从 Benchmark 库跳过来预选数据集：/tasks/create?datasets=mmlu,gsm8k
  useEffect(() => {
    const preset = searchParams.get('datasets');
    if (!preset) return;
    const names = preset.split(',').map((s) => s.trim()).filter(Boolean);
    if (names.length === 0) return;
    setFormData((prev) => ({
      ...prev,
      datasets: Array.from(new Set([...prev.datasets, ...names])),
    }));
    message.success(`已预选 ${names.length} 个数据集，请继续完善任务信息`);
  }, [searchParams]);

  // ========== 模型选择处理 ==========
  const handleSelectManagedModel = (modelId: number) => {
    setSelectedManagedModelId(modelId);
    const model = managedModels.find(item => item.id === modelId);
    if (model) {
      setFormData(prev => ({
        ...prev,
        modelConfig: {
          model_name: model.model_name,
          model_type: model.model_type,
          model_url: model.api_url || undefined,
          model_key: undefined,
        }
      }));
    }
  };

  // ========== 通用字段更新函数 ==========
  const updateFormData = <K extends keyof TaskFormData>(field: K, value: TaskFormData[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const updateModelConfig = <K extends keyof ModelConfig>(field: K, value: ModelConfig[K]) => {
    setFormData(prev => ({
      ...prev,
      modelConfig: { ...prev.modelConfig, [field]: value }
    }));
  };

  // ========== 步骤导航 ==========
  const handleNext = () => {
    // 步骤1：验证模型配置
    if (currentStep === 0) {
      if (!formData.modelConfig.model_name || formData.modelConfig.model_name.trim() === '') {
        message.error('请选择或输入模型名称');
        return;
      }
    }
    // 步骤2：验证数据集选择
    if (currentStep === 1) {
      if (!formData.datasets || formData.datasets.length === 0) {
        message.error('请至少选择一个数据集');
        return;
      }
    }
    setCurrentStep(currentStep + 1);
  };

  const handlePrev = () => {
    setCurrentStep(currentStep - 1);
  };

  // ========== 提交任务 ==========
  const handleSubmit = async () => {
    console.log('=== 提交任务 ===');
    console.log('表单数据:', formData);

    // 最终验证
    if (!formData.name || formData.name.trim() === '') {
      message.error('请输入任务名称');
      return;
    }

    if (!formData.modelConfig.model_name || formData.modelConfig.model_name.trim() === '') {
      message.error('请输入模型名称');
      return;
    }

    if (!formData.datasets || formData.datasets.length === 0) {
      message.error('请至少选择一个数据集');
      return;
    }

    setLoading(true);

    try {
      console.log('=== 提交任务参数 ===');
      console.log('formData.limit:', formData.limit, '类型:', typeof formData.limit);
      console.log('完整 formData:', JSON.stringify(formData, null, 2));

      const taskParams = {
        name: formData.name.trim(),
        description: formData.description?.trim() || '',
        model_name: formData.modelConfig.model_name.trim(),
        model_type: formData.modelConfig.model_type,
        model_url: formData.modelConfig.model_url,
        model_key: formData.modelConfig.model_key,
        generation_config: {
          stream: formData.stream,
        },
        datasets: formData.datasets,
        dataset_args: {},
        limit: formData.limit ?? undefined,  // 使用 ?? 而不是 ||
        eval_batch_size: formData.eval_batch_size,
        engine: formData.engine,
      };

      console.log('发送到后端的 taskParams:', JSON.stringify(taskParams, null, 2));

      console.log('提交参数:', taskParams);

      await createTask(taskParams);
      message.success('任务创建成功');
      navigate('/tasks');
    } catch (error: any) {
      console.error('创建任务失败:', error);
      const errMsg = error?.response?.data?.detail || error?.message || '创建任务失败';
      message.error(errMsg);
    } finally {
      setLoading(false);
    }
  };

  // ========== 步骤内容 ==========
  const steps = [
    {
      title: '选择模型',
      content: (
        <>
          {/* 选择已管理的模型 */}
          {managedModels.length > 0 && (
            <>
              <Form.Item label="选择已管理的模型">
                <Select
                  placeholder="从已管理的模型中选择"
                  allowClear
                  value={selectedManagedModelId}
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

          <Form.Item label="模型类型" required>
            <Select
              value={formData.modelConfig.model_type}
              onChange={(value) => updateModelConfig('model_type', value)}
              options={models.map((m) => ({ label: m.name, value: m.name }))}
            />
          </Form.Item>

          <Form.Item label="模型名称" required>
            <Input
              placeholder="例如: gpt-4, qwen-72b, etc."
              value={formData.modelConfig.model_name}
              onChange={(e) => updateModelConfig('model_name', e.target.value)}
            />
          </Form.Item>

          <Form.Item label="API URL (可选)">
            <Input
              placeholder="例如: https://api.openai.com/v1"
              value={formData.modelConfig.model_url || ''}
              onChange={(e) => updateModelConfig('model_url', e.target.value || undefined)}
            />
          </Form.Item>

          <Form.Item label="API Key (可选)">
            <Input.Password
              placeholder="API Key"
              value={formData.modelConfig.model_key || ''}
              onChange={(e) => updateModelConfig('model_key', e.target.value || undefined)}
            />
          </Form.Item>
        </>
      ),
    },
    {
      title: '选择数据集',
      content: (
        <div>
          <Select
            mode="multiple"
            allowClear
            showSearch
            value={formData.datasets}
            placeholder="搜索并选择数据集"
            filterOption={false}
            maxTagTextLength={32}
            style={{ width: '100%', marginBottom: 16 }}
            onSearch={(value) => fetchDatasets({ search: value, limit: 100 })}
            onChange={(values) => updateFormData('datasets', values)}
            options={datasets.map((ds) => ({
              label: ds.pretty_name || ds.name,
              value: ds.name,
            }))}
            optionRender={(option) => {
              const ds = datasets.find(item => item.name === option.value);
              if (!ds) return option.label;

              return (
                <Space size={4} wrap>
                  <span style={{ fontWeight: 500 }}>{ds.pretty_name || ds.name}</span>
                  {ds.need_sandbox && (
                    <Tooltip title="此数据集需要在 Docker 沙箱中执行代码">
                      <Tag color="orange" style={{ margin: 0 }}>🐳 沙箱</Tag>
                    </Tooltip>
                  )}
                  {ds.need_judge && (
                    <Tooltip title="此数据集需要 LLM 作为评判器">
                      <Tag color="purple" style={{ margin: 0 }}>⚖️ LLM评判</Tag>
                    </Tooltip>
                  )}
                  {ds.tags?.map((tag) => (
                    <Tag
                      key={tag}
                      color={tag === 'Coding' ? 'volcano' : 'blue'}
                      style={{ margin: 0 }}
                    >
                      {tag}
                    </Tag>
                  ))}
                </Space>
              );
            }}
          />

          {/* 沙箱说明 */}
          <Alert
            message="数据集说明"
            description={
              <div style={{ fontSize: 13 }}>
                <div>
                  <Tag color="orange">🐳 沙箱</Tag>
                  <span style={{ marginLeft: 4 }}>
                    标记的数据集为编程类评测，需要 Docker 沙箱执行代码（首次运行会启动容器，耗时较长）
                  </span>
                </div>
                <div style={{ marginTop: 4 }}>
                  <Tag color="purple">⚖️ LLM 评判</Tag>
                  <span style={{ marginLeft: 4 }}>
                    标记的数据集需要 LLM 作为评判器（系统将自动使用您选择的模型作为评判模型）
                  </span>
                </div>
                <div style={{ marginTop: 4 }}>
                  <Tag color="blue">标签</Tag>
                  <span style={{ marginLeft: 4 }}>
                    数据集的能力分类（Math、Coding、Knowledge 等）
                  </span>
                </div>
              </div>
            }
            type="info"
            showIcon
            closable
            style={{ marginBottom: 16 }}
          />

          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span>已选择: <strong>{formData.datasets.length}</strong> 个数据集</span>

            <Space size={4} wrap>
              {/* 选中数据集中需要沙箱的提示 */}
              {formData.datasets.some(name => {
                const ds = datasets.find(d => d.name === name);
                return ds?.need_sandbox;
              }) && (
                <Tag color="orange">🐳 包含沙箱数据集</Tag>
              )}

              {/* 选中数据集中需要 LLM judge 的提示 */}
              {formData.datasets.some(name => {
                const ds = datasets.find(d => d.name === name);
                return ds?.need_judge;
              }) && (
                <Tag color="purple">⚖️ 包含需要 LLM 评判的数据集</Tag>
              )}
            </Space>
          </div>
        </div>
      ),
    },
    {
      title: '配置参数',
      content: (
        <>
          <Form.Item label="评测引擎">
            <Select
              value={formData.engine}
              onChange={(value) => updateFormData('engine', value)}
              options={engines.map(e => ({
                label: `${e.name} - ${e.description}`,
                value: e.name
              }))}
            />
          </Form.Item>

          <Form.Item label="样本数限制 (可选)">
            <InputNumber
              min={1}
              max={10000}
              placeholder="留空则评测全部"
              style={{ width: '100%' }}
              value={formData.limit}
              onChange={(value) => {
                console.log('limit 输入值:', value, '类型:', typeof value);
                updateFormData('limit', value ?? undefined);
              }}
            />
          </Form.Item>

          <Form.Item label="评测批次" extra="并发评测的样本数量，建议 1-10">
            <InputNumber
              min={1}
              max={10}
              style={{ width: '100%' }}
              value={formData.eval_batch_size}
              onChange={(value) => updateFormData('eval_batch_size', value || 3)}
            />
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
              <Switch
                checked={formData.stream}
                onChange={(checked) => updateFormData('stream', checked)}
                checkedChildren="ON"
                unCheckedChildren="OFF"
              />
            </div>
          </div>
        </>
      ),
    },
    {
      title: '确认提交',
      content: (
        <>
          <Form.Item label="任务名称" required>
            <Input
              placeholder="例如: GPT-4 MMLU 评测"
              value={formData.name}
              onChange={(e) => updateFormData('name', e.target.value)}
            />
          </Form.Item>

          <Form.Item label="任务描述 (可选)">
            <Input.TextArea
              rows={3}
              placeholder="任务的简单描述..."
              value={formData.description || ''}
              onChange={(e) => updateFormData('description', e.target.value)}
            />
          </Form.Item>

          <Card size="small" style={{ marginTop: 16, background: '#fafafa' }}>
            <h4>配置摘要</h4>
            <p><strong>模型名称:</strong> {formData.modelConfig.model_name || <span style={{ color: '#ff4d4f' }}>未设置</span>}</p>
            <p><strong>模型类型:</strong> {formData.modelConfig.model_type}</p>
            <p><strong>API URL:</strong> {formData.modelConfig.model_url || '未设置'}</p>
            <p>
              <strong>数据集:</strong>{' '}
              {formData.datasets.length > 0 ? (
                <Space size={4} wrap>
                  {formData.datasets.map((name) => {
                    const ds = datasets.find(d => d.name === name);
                    let icon = '';
                    let color: string = 'default';
                    if (ds?.need_sandbox) {
                      icon = '🐳 ';
                      color = 'orange';
                    } else if (ds?.need_judge) {
                      icon = '⚖️ ';
                      color = 'purple';
                    }
                    return (
                      <Tag key={name} color={color}>
                        {icon}{name}
                      </Tag>
                    );
                  })}
                </Space>
              ) : (
                <span style={{ color: '#ff4d4f' }}>未选择</span>
              )}
            </p>
            <p><strong>评测引擎:</strong> {formData.engine}</p>
            <p><strong>样本数限制:</strong> {formData.limit || '全部'}</p>

            {/* 沙箱提示 */}
            {formData.datasets.some(name => {
              const ds = datasets.find(d => d.name === name);
              return ds?.need_sandbox;
            }) && (
              <Alert
                message="将启用 Docker 沙箱"
                description="所选数据集包含编程类评测，运行时将自动启动 Docker 容器执行代码。首次启动可能需要 10-30 秒。"
                type="warning"
                showIcon
                style={{ marginTop: 12 }}
              />
            )}

            {/* LLM Judge 提示 */}
            {formData.datasets.some(name => {
              const ds = datasets.find(d => d.name === name);
              return ds?.need_judge;
            }) && (
              <Alert
                message="将启用 LLM 评判器"
                description={`所选数据集包含需要 LLM 评判的评测（如 Minerva-Math 等）。系统将自动使用您选择的模型「${formData.modelConfig.model_name}」作为评判器评估答案正确性，会增加评测时间。`}
                type="warning"
                showIcon
                style={{ marginTop: 12 }}
              />
            )}

            {(!formData.modelConfig.model_name || formData.datasets.length === 0) && (
              <div style={{ marginTop: 12, padding: 12, background: '#fff2e8', border: '1px solid #ffbb96', borderRadius: 4 }}>
                <strong style={{ color: '#d4380d' }}>⚠️ 请检查配置</strong>
                <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#595959' }}>
                  请确保已完成前序步骤：选择模型和数据集
                </p>
              </div>
            )}
          </Card>
        </>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        icon={<PlusOutlined />}
        title="创建评测任务"
        subtitle="按步骤配置模型、数据集与执行参数"
      />

      <Card style={{ borderRadius: 14, border: '1px solid #eef0f4' }}>
        <Steps current={currentStep} items={steps.map((s) => ({ title: s.title }))} />

        <Form layout="vertical">
          <div style={{ marginTop: 32, minHeight: 300 }}>
            {steps[currentStep].content}
          </div>
        </Form>

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
              <Button type="primary" onClick={handleSubmit} loading={loading}>
                提交任务
              </Button>
            )}
          </Space>
        </div>
      </Card>
    </div>
  );
};

export default TaskCreate;
