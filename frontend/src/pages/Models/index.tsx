import { useEffect, useState } from 'react';
import {
  Card,
  Row,
  Col,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Switch,
  Descriptions,
  message,
  Popconfirm,
  Empty
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  StarOutlined,
  StarFilled,
  ApiOutlined,
  SettingOutlined,
  ThunderboltOutlined
} from '@ant-design/icons';
import { modelApi, type ConnectionTestResult } from '@/api/models';
import type { ManagedModel } from '@/types';
import PageHeader from '@/components/common/PageHeader';
import TestResultModal from './TestResultModal';

const ModelsPage: React.FC = () => {
  const [models, setModels] = useState<ManagedModel[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingModel, setEditingModel] = useState<ManagedModel | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ManagedModel | null>(null);
  const [testingModel, setTestingModel] = useState<number | null>(null);
  const [testTargetModel, setTestTargetModel] = useState<ManagedModel | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [form] = Form.useForm();

  const fetchModels = async () => {
    try {
      const data = await modelApi.list({ limit: 100 });
      setModels(data.models);
    } catch (error: any) {
      message.error(error.message || '获取模型列表失败');
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      await modelApi.create(values);
      message.success('模型添加成功');
      setModalVisible(false);
      form.resetFields();
      fetchModels();
    } catch (error: any) {
      message.error(error.message || '添加模型失败');
    }
  };

  const handleUpdate = async () => {
    if (!editingModel) return;
    try {
      const values = await form.validateFields();
      await modelApi.update(editingModel.id, values);
      message.success('模型更新成功');
      setModalVisible(false);
      form.resetFields();
      setEditingModel(null);
      fetchModels();
    } catch (error: any) {
      message.error(error.message || '更新模型失败');
    }
  };

  const handleDelete = async (modelId: number) => {
    try {
      await modelApi.delete(modelId);
      message.success('模型删除成功');
      fetchModels();
    } catch (error: any) {
      message.error(error.message || '删除模型失败');
    }
  };

  const handleSetDefault = async (modelId: number) => {
    try {
      await modelApi.setDefault(modelId);
      message.success('已设为默认模型');
      fetchModels();
    } catch (error: any) {
      message.error(error.message || '设置默认模型失败');
    }
  };

  const handleTest = async (model: ManagedModel) => {
    setTestTargetModel(model);
    setTestModalOpen(true);
    setTestResult(null);
    setTestingModel(model.id);
    try {
      const result = await modelApi.test(model.id);
      setTestResult(result);
    } catch (error: any) {
      setTestResult({
        success: false,
        latency_ms: 0,
        stream: false,
        request: null,
        response: null,
        error: error.message || '连接测试失败',
      });
    } finally {
      setTestingModel(null);
    }
  };

  const handleTestRetry = () => {
    if (testTargetModel) handleTest(testTargetModel);
  };

  const openEditModal = (model: ManagedModel) => {
    setEditingModel(model);
    form.setFieldsValue({ ...model, api_key: undefined });
    setModalVisible(true);
  };

  const openDetailModal = (model: ManagedModel) => {
    setSelectedModel(model);
    setDetailVisible(true);
  };

  const getModelTypeTag = (type: string) => {
    const typeMap: Record<string, { color: string; label: string }> = {
      'openai_api': { color: 'green', label: 'OpenAI API' },
      'anthropic_api': { color: 'purple', label: 'Anthropic API' },
      'llm_ckpt': { color: 'blue', label: 'ModelScope' },
      'text2image': { color: 'purple', label: '文生图' },
      'image_editing': { color: 'orange', label: '图像编辑' },
      'mock_llm': { color: 'default', label: 'Mock' },
    };
    const config = typeMap[type] || { color: 'default', label: type };
    return <Tag color={config.color}>{config.label}</Tag>;
  };

  return (
    <div>
      <PageHeader
        icon={<ApiOutlined />}
        title="模型管理"
        subtitle="维护可被评测任务复用的模型连接配置"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingModel(null);
              form.resetFields();
              setModalVisible(true);
            }}
          >
            添加模型
          </Button>
        }
      />

      <Row gutter={[16, 16]}>
        {models.length > 0 ? (
          models.map((model) => (
            <Col key={model.id} xs={24} sm={12} md={8} lg={6}>
              <Card
                hoverable
                actions={[
                  <Button
                    type="text"
                    size="small"
                    icon={<SettingOutlined />}
                    onClick={() => openDetailModal(model)}
                  >
                    详情
                  </Button>,
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => openEditModal(model)}
                  >
                    编辑
                  </Button>,
                  <Popconfirm
                    title="确定删除这个模型吗？"
                    onConfirm={() => handleDelete(model.id)}
                  >
                    <Button type="text" size="small" danger icon={<DeleteOutlined />}>
                      删除
                    </Button>
                  </Popconfirm>
                ]}
              >
                <Card.Meta
                  title={
                    <Space>
                      <span>{model.name}</span>
                      {model.is_default && <StarFilled style={{ color: '#faad14' }} />}
                    </Space>
                  }
                  description={
                    <div>
                      {getModelTypeTag(model.model_type)}
                      <div style={{ marginTop: 8, fontSize: 12, color: '#8c8c8c' }}>
                        <div>模型: {model.model_name}</div>
                        {model.api_url && (
                          <div>
                            <ApiOutlined /> {model.api_url.replace(/^https?:\/\//, '')}
                          </div>
                        )}
                        <div>使用次数: {model.use_count}</div>
                      </div>
                      {!model.is_default && (
                        <Button
                          type="link"
                          size="small"
                          icon={<StarOutlined />}
                          onClick={() => handleSetDefault(model.id)}
                          style={{ padding: 0, marginTop: 4 }}
                        >
                          设为默认
                        </Button>
                      )}
                      {(model.model_type === 'openai_api' || model.model_type === 'anthropic_api') && model.api_url && (
                        <Button
                          type="link"
                          size="small"
                          icon={<ThunderboltOutlined />}
                          onClick={() => handleTest(model)}
                          loading={testingModel === model.id}
                          style={{ padding: 0, marginTop: 4, marginLeft: 8 }}
                        >
                          测试连接
                        </Button>
                      )}
                    </div>
                  }
                />
              </Card>
            </Col>
          ))
        ) : (
          <Col span={24}>
            <Empty description="暂无已管理的模型" />
          </Col>
        )}
      </Row>

      {/* 添加/编辑弹窗 */}
      <Modal
        title={editingModel ? '编辑模型' : '添加模型'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          form.resetFields();
          setEditingModel(null);
        }}
        onOk={editingModel ? handleUpdate : handleCreate}
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="显示名称"
            rules={[{ required: true, message: '请输入显示名称' }]}
          >
            <Input placeholder="例如: GPT-4 生产环境" />
          </Form.Item>

          <Form.Item
            name="model_type"
            label="模型类型"
            rules={[{ required: true, message: '请选择模型类型' }]}
          >
            <Select
              placeholder="选择模型类型"
              options={[
                { label: 'OpenAI API', value: 'openai_api' },
                { label: 'Anthropic API', value: 'anthropic_api' },
                { label: 'ModelScope', value: 'llm_ckpt' },
                { label: '文生图', value: 'text2image' },
                { label: '图像编辑', value: 'image_editing' },
                { label: 'Mock', value: 'mock_llm' },
              ]}
            />
          </Form.Item>

          <Form.Item
            name="model_name"
            label="模型标识"
            rules={[{ required: true, message: '请输入模型标识' }]}
          >
            <Input placeholder="例如: gpt-4, qwen-72b" />
          </Form.Item>

          <Form.Item name="api_url" label="API URL">
            <Input placeholder="例如: https://api.openai.com/v1" />
          </Form.Item>

          <Form.Item name="api_key" label="API Key">
            <Input.Password placeholder="API Key" />
          </Form.Item>

          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="模型的简单描述..." />
          </Form.Item>

          <Form.Item name="is_default" label="设为默认模型" valuePropName="checked">
            <Switch />
          </Form.Item>

          <div
            style={{
              background: 'linear-gradient(135deg, #f7f9fc 0%, #f0f5ff 100%)',
              border: '1px solid #e6ebf5',
              padding: 16,
              borderRadius: 12,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <SettingOutlined style={{ color: '#1890ff' }} />
                <span style={{ fontWeight: 600, color: '#1f2d3d' }}>默认生成配置</span>
              </div>
              <span style={{ fontSize: 11, color: '#86909c' }}>
                创建评测任务时会作为默认值
              </span>
            </div>

            <Row gutter={[12, 12]}>
              <Col xs={24} sm={8}>
                <Form.Item
                  name={['generation_config', 'temperature']}
                  label={<span style={{ fontSize: 12, color: '#5e6b7a' }}>Temperature</span>}
                  style={{ marginBottom: 0 }}
                >
                  <InputNumber min={0} max={2} step={0.1} placeholder="0.7" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item
                  name={['generation_config', 'max_tokens']}
                  label={<span style={{ fontSize: 12, color: '#5e6b7a' }}>Max Tokens</span>}
                  style={{ marginBottom: 0 }}
                >
                  <InputNumber min={1} max={32768} placeholder="1024" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item
                  name={['generation_config', 'top_p']}
                  label={<span style={{ fontSize: 12, color: '#5e6b7a' }}>Top P</span>}
                  style={{ marginBottom: 0 }}
                >
                  <InputNumber min={0} max={1} step={0.1} placeholder="1.0" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          </div>
        </Form>
      </Modal>

      {/* 测试连接结果 Modal */}
      <TestResultModal
        open={testModalOpen}
        loading={testingModel != null}
        modelName={testTargetModel?.name}
        result={testResult}
        onClose={() => setTestModalOpen(false)}
        onRetry={handleTestRetry}
      />

      {/* 详情弹窗 */}
      <Modal
        title="模型详情"
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={600}
      >
        {selectedModel && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="显示名称">{selectedModel.name}</Descriptions.Item>
            <Descriptions.Item label="模型类型">
              {getModelTypeTag(selectedModel.model_type)}
            </Descriptions.Item>
            <Descriptions.Item label="模型标识">{selectedModel.model_name}</Descriptions.Item>
            <Descriptions.Item label="API URL">
              {selectedModel.api_url || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="API Key">
              {selectedModel.has_api_key ? '已配置' : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="描述">
              {selectedModel.description || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="默认模型">
              {selectedModel.is_default ? <Tag color="gold">是</Tag> : '否'}
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              {selectedModel.is_active ? <Tag color="success">活跃</Tag> : <Tag>已禁用</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="使用次数">{selectedModel.use_count}</Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {new Date(selectedModel.created_at).toLocaleString()}
            </Descriptions.Item>
            <Descriptions.Item label="默认配置">
              <pre style={{ margin: 0, fontSize: 12 }}>
                {JSON.stringify(selectedModel.generation_config, null, 2)}
              </pre>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
};

export default ModelsPage;
