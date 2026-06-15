import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  Row,
  Col,
  Input,
  Tag,
  Tabs,
  Spin,
  Empty,
  Typography,
  Checkbox,
  Switch,
  Button,
  Drawer,
  Space,
  Tooltip,
  Badge,
  Divider,
} from 'antd';
import {
  SearchOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  DatabaseOutlined,
  ApiOutlined,
  ExperimentOutlined,
  ClearOutlined,
  ThunderboltOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useCatalogStore } from '@/stores';
import type { Dataset, ModelType, Metric } from '@/types';
import PageHeader from '@/components/common/PageHeader';

// 将后端 tag 按四个维度分组（基于实际数据 30 个 tag 设计）
const TAG_GROUPS: { key: string; label: string; tags: { tag: string; label: string }[] }[] = [
  {
    key: 'capability',
    label: '能力维度',
    tags: [
      { tag: 'Knowledge', label: '通用知识' },
      { tag: 'Reasoning', label: '推理' },
      { tag: 'Math', label: '数学' },
      { tag: 'Coding', label: '编程' },
      { tag: 'Chinese', label: '中文' },
      { tag: 'MultiLingual', label: '多语言' },
      { tag: 'Commonsense', label: '常识' },
      { tag: 'Medical', label: '医疗' },
      { tag: 'Hallucination', label: '幻觉检测' },
      { tag: 'LongContext', label: '长上下文' },
    ],
  },
  {
    key: 'task',
    label: '任务类型',
    tags: [
      { tag: 'MCQ', label: '多选题' },
      { tag: 'QA', label: '问答' },
      { tag: 'NER', label: '实体识别' },
      { tag: 'Yes/No', label: '是/否' },
      { tag: 'ReadingComprehension', label: '阅读理解' },
      { tag: 'MachineTranslation', label: '机器翻译' },
      { tag: 'Arena', label: '竞技场' },
      { tag: 'MultiTurn', label: '多轮对话' },
      { tag: 'Retrieval', label: '检索' },
    ],
  },
  {
    key: 'modality',
    label: '模态',
    tags: [
      { tag: 'MultiModal', label: '多模态' },
      { tag: 'TextToImage', label: '文生图' },
      { tag: 'ImageCaptioning', label: '图像描述' },
      { tag: 'ImageEditing', label: '图像编辑' },
      { tag: 'Grounding', label: '视觉定位' },
      { tag: 'Audio', label: '音频' },
      { tag: 'SpeechRecognition', label: '语音识别' },
    ],
  },
  {
    key: 'feature',
    label: '执行特性',
    tags: [
      { tag: 'Agent', label: 'Agent' },
      { tag: 'FunctionCalling', label: '函数调用' },
      { tag: 'InstructionFollowing', label: '指令遵循' },
      { tag: 'Custom', label: '自定义' },
    ],
  },
];

const Catalog: React.FC = () => {
  const navigate = useNavigate();
  const { datasets, models, metrics, loading, fetchDatasets, fetchModels, fetchMetrics } =
    useCatalogStore();

  const [activeTab, setActiveTab] = useState<'datasets' | 'models' | 'metrics'>('datasets');
  const [searchText, setSearchText] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [needSandbox, setNeedSandbox] = useState(false);
  const [needJudge, setNeedJudge] = useState(false);
  const [detailDataset, setDetailDataset] = useState<Dataset | null>(null);

  useEffect(() => {
    if (activeTab === 'datasets') fetchDatasets({ limit: 200 });
    else if (activeTab === 'models') fetchModels();
    else if (activeTab === 'metrics') fetchMetrics();
  }, [activeTab]);

  // 每个 tag 在当前数据集中出现的次数（用于在筛选项后显示计数）
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of datasets) {
      for (const t of d.tags || []) counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
  }, [datasets]);

  const filteredDatasets = useMemo(() => {
    const q = searchText.toLowerCase();
    return datasets.filter((d) => {
      if (q) {
        const hit =
          d.name.toLowerCase().includes(q) ||
          d.pretty_name?.toLowerCase().includes(q) ||
          d.description?.toLowerCase().includes(q) ||
          d.tags?.some((t) => t.toLowerCase().includes(q));
        if (!hit) return false;
      }
      if (selectedTags.length > 0 && !selectedTags.some((t) => d.tags?.includes(t))) return false;
      if (needSandbox && !d.need_sandbox) return false;
      if (needJudge && !d.need_judge) return false;
      return true;
    });
  }, [datasets, searchText, selectedTags, needSandbox, needJudge]);

  const filteredModels = useMemo(() => {
    const q = searchText.toLowerCase();
    return models.filter(
      (m) =>
        m.name.toLowerCase().includes(q) || m.description?.toLowerCase().includes(q)
    );
  }, [models, searchText]);

  const filteredMetrics = useMemo(() => {
    const q = searchText.toLowerCase();
    return metrics.filter(
      (m) =>
        m.name.toLowerCase().includes(q) || m.description?.toLowerCase().includes(q)
    );
  }, [metrics, searchText]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const clearFilters = () => {
    setSelectedTags([]);
    setNeedSandbox(false);
    setNeedJudge(false);
  };

  const activeFilterCount = selectedTags.length + (needSandbox ? 1 : 0) + (needJudge ? 1 : 0);

  const handleUseDataset = (name: string) => {
    navigate(`/tasks/create?datasets=${encodeURIComponent(name)}`);
  };

  // ============ 卡片渲染 ============
  const renderDatasetCard = (d: Dataset) => {
    const metricNames = (d.metric_list || [])
      .map((m: any) => (typeof m === 'string' ? m : Object.keys(m)[0]))
      .filter(Boolean);

    return (
      <Card
        size="small"
        hoverable
        style={{ height: '100%' }}
        styles={{ body: { padding: 14, display: 'flex', flexDirection: 'column', height: '100%' } }}
      >
        <div style={{ flex: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: 'linear-gradient(135deg, #1890ff 0%, #9254de 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <DatabaseOutlined style={{ color: '#fff', fontSize: 18 }} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <Typography.Text
                strong
                style={{ fontSize: 14, display: 'block', lineHeight: '20px' }}
                ellipsis={{ tooltip: d.pretty_name || d.name }}
              >
                {d.pretty_name || d.name}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {d.name}
              </Typography.Text>
            </div>
          </div>

          {d.tags && d.tags.length > 0 && (
            <div style={{ marginBottom: 8, minHeight: 22 }}>
              {d.tags.slice(0, 3).map((t) => (
                <Tag key={t} color="blue" style={{ fontSize: 10, marginBottom: 2 }}>
                  {t}
                </Tag>
              ))}
              {d.tags.length > 3 && (
                <Tooltip title={d.tags.slice(3).join(', ')}>
                  <Tag style={{ fontSize: 10 }}>+{d.tags.length - 3}</Tag>
                </Tooltip>
              )}
            </div>
          )}

          <div style={{ fontSize: 11, color: '#8c8c8c', lineHeight: '18px' }}>
            <div>
              <strong>{d.subset_list?.length || 0}</strong> subsets · <strong>{d.few_shot_num}</strong>-shot
            </div>
            {metricNames.length > 0 && (
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                指标: {metricNames.slice(0, 3).join(', ')}
              </div>
            )}
          </div>

          {(d.need_sandbox || d.need_judge) && (
            <div style={{ marginTop: 6 }}>
              {d.need_sandbox && (
                <Tooltip title="需要沙箱环境执行（编程类）">
                  <Tag icon={<SafetyCertificateOutlined />} color="orange" style={{ fontSize: 10 }}>
                    沙箱
                  </Tag>
                </Tooltip>
              )}
              {d.need_judge && (
                <Tooltip title="需要 LLM 评判器">
                  <Tag icon={<ThunderboltOutlined />} color="purple" style={{ fontSize: 10 }}>
                    Judge
                  </Tag>
                </Tooltip>
              )}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 6,
            marginTop: 10,
            paddingTop: 10,
            borderTop: '1px dashed #f0f0f0',
          }}
        >
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => setDetailDataset(d)}
            style={{ flex: 1 }}
          >
            查看
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={() => handleUseDataset(d.name)}
            style={{ flex: 1 }}
          >
            用于评测
          </Button>
        </div>
      </Card>
    );
  };

  const renderModelCard = (m: ModelType) => (
    <Card size="small" hoverable style={{ height: '100%' }}>
      <Card.Meta
        avatar={
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #52c41a 0%, #1890ff 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ApiOutlined style={{ color: '#fff', fontSize: 18 }} />
          </div>
        }
        title={m.name}
        description={
          <Typography.Paragraph
            type="secondary"
            style={{ fontSize: 12, marginBottom: 0 }}
            ellipsis={{ rows: 3, tooltip: m.description }}
          >
            {m.description || '无描述'}
          </Typography.Paragraph>
        }
      />
    </Card>
  );

  const renderMetricCard = (m: Metric) => (
    <Card size="small" hoverable style={{ height: '100%' }}>
      <Card.Meta
        avatar={
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #faad14 0%, #f5222d 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ExperimentOutlined style={{ color: '#fff', fontSize: 18 }} />
          </div>
        }
        title={
          <Space>
            <span>{m.name}</span>
            {m.category && <Tag color="green">{m.category}</Tag>}
          </Space>
        }
        description={
          <Typography.Paragraph
            type="secondary"
            style={{ fontSize: 12, marginBottom: 0 }}
            ellipsis={{ rows: 3, tooltip: m.description }}
          >
            {m.description || '无描述'}
          </Typography.Paragraph>
        }
      />
    </Card>
  );

  // ============ 左侧筛选面板 ============
  const FilterPanel = (
    <div
      style={{
        background: '#fff',
        borderRadius: 12,
        padding: 16,
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        position: 'sticky',
        top: 88,
        maxHeight: 'calc(100vh - 120px)',
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Typography.Text strong style={{ fontSize: 14 }}>
          筛选
          {activeFilterCount > 0 && (
            <Badge
              count={activeFilterCount}
              style={{ marginLeft: 8, backgroundColor: '#1890ff' }}
            />
          )}
        </Typography.Text>
        {activeFilterCount > 0 && (
          <Button
            type="link"
            size="small"
            icon={<ClearOutlined />}
            onClick={clearFilters}
            style={{ padding: 0, fontSize: 12 }}
          >
            清空
          </Button>
        )}
      </div>

      {TAG_GROUPS.map((group) => {
        const visibleTags = group.tags.filter((t) => tagCounts[t.tag] > 0);
        if (visibleTags.length === 0) return null;
        return (
          <div key={group.key} style={{ marginBottom: 16 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>
              {group.label}
            </Typography.Text>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {visibleTags.map(({ tag, label }) => (
                <Checkbox
                  key={tag}
                  checked={selectedTags.includes(tag)}
                  onChange={() => toggleTag(tag)}
                  style={{ fontSize: 13 }}
                >
                  <span style={{ display: 'inline-flex', justifyContent: 'space-between', width: '100%', gap: 6 }}>
                    <span>{label}</span>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {tagCounts[tag] || 0}
                    </Typography.Text>
                  </span>
                </Checkbox>
              ))}
            </div>
          </div>
        );
      })}

      <Divider style={{ margin: '12px 0' }} />

      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>
          额外条件
        </Typography.Text>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13 }}>需要沙箱</span>
            <Switch size="small" checked={needSandbox} onChange={setNeedSandbox} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13 }}>需要 LLM Judge</span>
            <Switch size="small" checked={needJudge} onChange={setNeedJudge} />
          </div>
        </div>
      </div>
    </div>
  );

  // ============ Tab 内容 ============
  const tabItems = [
    {
      key: 'datasets',
      label: (
        <span>
          <DatabaseOutlined /> Benchmark <Badge count={filteredDatasets.length} style={{ backgroundColor: '#1890ff' }} overflowCount={999} />
        </span>
      ),
      children: (
        <Spin spinning={loading}>
          <Row gutter={[12, 12]}>
            {filteredDatasets.length > 0 ? (
              filteredDatasets.map((d) => (
                <Col key={d.name} xs={24} sm={12} md={12} lg={8} xl={8} xxl={6}>
                  {renderDatasetCard(d)}
                </Col>
              ))
            ) : (
              <Col span={24}>
                <Empty description="没有匹配的 Benchmark，试试清空筛选条件" />
              </Col>
            )}
          </Row>
        </Spin>
      ),
    },
    {
      key: 'models',
      label: (
        <span>
          <ApiOutlined /> 模型类型 <Badge count={filteredModels.length} style={{ backgroundColor: '#52c41a' }} overflowCount={999} />
        </span>
      ),
      children: (
        <Spin spinning={loading}>
          <Row gutter={[12, 12]}>
            {filteredModels.length > 0 ? (
              filteredModels.map((m) => (
                <Col key={m.name} xs={24} sm={12} md={12} lg={8} xl={8}>
                  {renderModelCard(m)}
                </Col>
              ))
            ) : (
              <Col span={24}>
                <Empty description="暂无模型类型" />
              </Col>
            )}
          </Row>
        </Spin>
      ),
    },
    {
      key: 'metrics',
      label: (
        <span>
          <ExperimentOutlined /> 评测指标 <Badge count={filteredMetrics.length} style={{ backgroundColor: '#faad14' }} overflowCount={999} />
        </span>
      ),
      children: (
        <Spin spinning={loading}>
          <Row gutter={[12, 12]}>
            {filteredMetrics.length > 0 ? (
              filteredMetrics.map((m) => (
                <Col key={m.name} xs={24} sm={12} md={12} lg={8} xl={8}>
                  {renderMetricCard(m)}
                </Col>
              ))
            ) : (
              <Col span={24}>
                <Empty description="暂无指标" />
              </Col>
            )}
          </Row>
        </Spin>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        icon={<DatabaseOutlined />}
        title="Benchmark 库"
        subtitle="浏览可用的评测基准、模型类型与指标，按能力维度筛选，一键发起评测任务"
      />

      <Row gutter={16}>
        {/* 左侧筛选面板 —— 仅在 Benchmark Tab 显示 */}
        {activeTab === 'datasets' && (
          <Col xs={24} sm={24} md={7} lg={6} xl={5}>
            {FilterPanel}
          </Col>
        )}

        {/* 右侧主区域 */}
        <Col
          xs={24}
          sm={24}
          md={activeTab === 'datasets' ? 17 : 24}
          lg={activeTab === 'datasets' ? 18 : 24}
          xl={activeTab === 'datasets' ? 19 : 24}
        >
          <Card styles={{ body: { padding: 16 } }}>
            <Input
              placeholder={
                activeTab === 'datasets'
                  ? '搜索 benchmark 名称、描述或标签...'
                  : activeTab === 'models'
                  ? '搜索模型类型...'
                  : '搜索指标...'
              }
              prefix={<SearchOutlined />}
              allowClear
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ marginBottom: 16 }}
              size="large"
            />

            <Tabs
              activeKey={activeTab}
              onChange={(k) => setActiveTab(k as any)}
              items={tabItems}
              size="large"
            />
          </Card>
        </Col>
      </Row>

      {/* 详情抽屉 */}
      <Drawer
        title={
          <Space>
            <DatabaseOutlined style={{ color: '#1890ff' }} />
            {detailDataset?.pretty_name || detailDataset?.name}
          </Space>
        }
        width={640}
        open={!!detailDataset}
        onClose={() => setDetailDataset(null)}
        extra={
          detailDataset && (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={() => {
                handleUseDataset(detailDataset.name);
                setDetailDataset(null);
              }}
            >
              用于评测
            </Button>
          )
        }
      >
        {detailDataset && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <Typography.Text type="secondary">名称</Typography.Text>
              <div style={{ fontFamily: 'monospace', fontSize: 13 }}>{detailDataset.name}</div>
            </div>

            {detailDataset.tags && detailDataset.tags.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <Typography.Text type="secondary">标签</Typography.Text>
                <div style={{ marginTop: 4 }}>
                  {detailDataset.tags.map((t) => (
                    <Tag key={t} color="blue">
                      {t}
                    </Tag>
                  ))}
                </div>
              </div>
            )}

            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={8}>
                <Typography.Text type="secondary">Subsets</Typography.Text>
                <div style={{ fontSize: 16, fontWeight: 600 }}>
                  {detailDataset.subset_list?.length || 0}
                </div>
              </Col>
              <Col span={8}>
                <Typography.Text type="secondary">Few-shot</Typography.Text>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{detailDataset.few_shot_num}</div>
              </Col>
              <Col span={8}>
                <Typography.Text type="secondary">输出类型</Typography.Text>
                <div style={{ fontSize: 13 }}>
                  {detailDataset.output_types?.join(', ') || '-'}
                </div>
              </Col>
            </Row>

            {(detailDataset.need_sandbox || detailDataset.need_judge) && (
              <div style={{ marginBottom: 16 }}>
                <Typography.Text type="secondary">执行特性</Typography.Text>
                <div style={{ marginTop: 4 }}>
                  {detailDataset.need_sandbox && (
                    <Tag icon={<SafetyCertificateOutlined />} color="orange">
                      需要沙箱
                    </Tag>
                  )}
                  {detailDataset.need_judge && (
                    <Tag icon={<ThunderboltOutlined />} color="purple">
                      需要 LLM Judge
                    </Tag>
                  )}
                </div>
              </div>
            )}

            {detailDataset.subset_list && detailDataset.subset_list.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <Typography.Text type="secondary">Subset 列表</Typography.Text>
                <div style={{ marginTop: 4 }}>
                  {detailDataset.subset_list.map((s) => (
                    <Tag key={s}>{s}</Tag>
                  ))}
                </div>
              </div>
            )}

            {detailDataset.description && (
              <div>
                <Typography.Text type="secondary">描述</Typography.Text>
                <div
                  style={{
                    marginTop: 4,
                    padding: 12,
                    background: '#fafafa',
                    borderRadius: 6,
                    fontSize: 13,
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.6,
                    color: '#595959',
                  }}
                >
                  {detailDataset.description}
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
};

export default Catalog;
