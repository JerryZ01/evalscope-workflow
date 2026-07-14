import { useState } from 'react';
import { Card, Row, Col, Typography, Tag, Collapse, Button, Space, Anchor } from 'antd';
import {
  ReadOutlined,
  DashboardOutlined,
  UnorderedListOutlined,
  PlusOutlined,
  DatabaseOutlined,
  ApiOutlined,
  SettingOutlined,
  LinkOutlined,
  RocketOutlined,
  ExperimentOutlined,
  BulbOutlined,
  QuestionCircleOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  PlayCircleOutlined,
  FileTextOutlined,
  CloudServerOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/common/PageHeader';

const { Title, Paragraph, Text } = Typography;

interface FeatureCard {
  icon: React.ReactNode;
  title: string;
  path: string;
  gradient: string;
  accent: string;
  desc: string;
  tags: string[];
}

const FEATURES: FeatureCard[] = [
  {
    icon: <DashboardOutlined />,
    title: '仪表盘',
    path: '/dashboard',
    gradient: 'linear-gradient(135deg, #1890ff 0%, #096dd9 100%)',
    accent: '#1890ff',
    desc: '一览全平台运行态：任务状态计数（运行中 / 已完成 / 待执行 / 失败）、资源统计（Benchmark 数 / 模型数）、最近任务列表。',
    tags: ['全局总览', '快速入口'],
  },
  {
    icon: <DatabaseOutlined />,
    title: 'Benchmark 库',
    path: '/catalog',
    gradient: 'linear-gradient(135deg, #9254de 0%, #722ed1 100%)',
    accent: '#9254de',
    desc: '浏览 156+ 个内置评测数据集，按"能力维度 / 任务类型 / 模态 / 执行特性"四个维度筛选；每张卡片可直接「用于评测」一键跳到创建任务并预选。',
    tags: ['资源浏览', '按需筛选', '一键发起'],
  },
  {
    icon: <ApiOutlined />,
    title: '模型管理',
    path: '/models',
    gradient: 'linear-gradient(135deg, #52c41a 0%, #389e0d 100%)',
    accent: '#52c41a',
    desc: '保存模型的 API URL / API Key / 默认生成参数（temperature / max_tokens / top_p），后续创建任务时可一键复用，避免重复填写。',
    tags: ['连接管理', '参数复用', '连接测试'],
  },
  {
    icon: <PlusOutlined />,
    title: '创建任务',
    path: '/tasks/create',
    gradient: 'linear-gradient(135deg, #fa8c16 0%, #d46b08 100%)',
    accent: '#fa8c16',
    desc: '四步流程：① 选模型（可选已管理模型）② 选数据集（多选）③ 配置参数（评测引擎 / 样本数 / 流式开关）④ 命名并提交。',
    tags: ['核心流程', '4 步完成'],
  },
  {
    icon: <UnorderedListOutlined />,
    title: '任务列表',
    path: '/tasks',
    gradient: 'linear-gradient(135deg, #13c2c2 0%, #08979c 100%)',
    accent: '#13c2c2',
    desc: '所有评测任务的管理面板：启动 / 暂停 / 取消 / 重试 / 删除，支持搜索过滤，点行进入任务详情页查看进度与日志。',
    tags: ['批量管理', '搜索'],
  },
  {
    icon: <SettingOutlined />,
    title: '系统设置',
    path: '/settings',
    gradient: 'linear-gradient(135deg, #8c8c8c 0%, #595959 100%)',
    accent: '#8c8c8c',
    desc: '配置全局执行环境：评测输出目录、数据集缓存目录、是否启用 use_cache、debug 模式。',
    tags: ['运行环境'],
  },
  {
    icon: <LinkOutlined />,
    title: '评测平台 v1.0',
    path: '/eval-platform-v1',
    gradient: 'linear-gradient(135deg, #eb2f96 0%, #c41d7f 100%)',
    accent: '#eb2f96',
    desc: '嵌入旧版评测平台（annto-eval-ver），用于回看已有的历史评测榜单数据。',
    tags: ['兼容', '历史数据'],
  },
];

interface FlowStep {
  title: string;
  icon: React.ReactNode;
  desc: string;
  link: { label: string; path: string };
  details: string[];
}

const FLOW: FlowStep[] = [
  {
    title: '配置模型',
    icon: <ApiOutlined />,
    desc: '先把要评测的模型连接信息保存到「模型管理」，包含 API URL、API Key 与默认生成参数。',
    link: { label: '前往模型管理', path: '/models' },
    details: [
      '点击右上角「添加模型」',
      '填入显示名称（如 "GLM-4.7 生产环境"）、模型类型选 OpenAI API、模型标识填实际 model name（如 glm-4-7-251222）',
      '填 API URL（如 https://ark.cn-beijing.volces.com/api/v3）和 API Key',
      '在「默认生成配置」里设置 Temperature / Max Tokens / Top P（创建评测任务时会自动继承这些参数）',
      '保存后在模型卡片上点「测试连接」，会弹出 Modal 显示真实请求 + 真实响应，确认模型可达',
    ],
  },
  {
    title: '找 Benchmark',
    icon: <DatabaseOutlined />,
    desc: '在「Benchmark 库」筛选要测什么能力，每张数据集卡可直接「用于评测」跳到创建任务。',
    link: { label: '前往 Benchmark 库', path: '/catalog' },
    details: [
      '左侧筛选面板按"能力（中文/数学/编程/推理…）/ 任务类型 / 模态 / 执行特性"四个维度多选',
      '可勾选「需要沙箱」/「需要 LLM Judge」过滤特殊数据集',
      '点卡片上「查看」展开详情抽屉，包含完整描述、subset 列表、指标',
      '点卡片上「用于评测」直接跳到创建任务页并自动预选该数据集',
    ],
  },
  {
    title: '创建任务',
    icon: <PlusOutlined />,
    desc: '4 个步骤：选模型 → 选数据集 → 配置参数 → 命名提交，全程引导式。',
    link: { label: '前往创建任务', path: '/tasks/create' },
    details: [
      '步骤 1 - 选模型：可从「已管理的模型」下拉选择（自动填充 URL/Key），也可手动输入',
      '步骤 2 - 选数据集：多选，包含编程或 LLM-Judge 类数据集时页面会自动提示',
      '步骤 3 - 配置参数：选评测引擎、样本数限制、评测批次；底部「流式响应」开关决定本任务是否使用 SSE 流式调用模型 API',
      '步骤 4 - 确认提交：取名 + 写描述 + 校验摘要 → 提交后任务进入待执行队列',
    ],
  },
  {
    title: '执行与查看',
    icon: <PlayCircleOutlined />,
    desc: '在任务列表启动，详情页实时看进度、日志、状态；完成后自动加载可视化报告。',
    link: { label: '前往任务列表', path: '/tasks' },
    details: [
      '在任务列表上点「启动」开始执行（pending → running）',
      '点击任务进入详情页：右上角圆环显示进度，状态徽章实时更新（SSE 推送 + 5s 兜底轮询）',
      '"评测日志"区每 3 秒拉取最新输出，可以看到 evalscope 内部的执行细节',
      '任务完成后自动加载评测结果图表（条形 / 雷达 / 折线）和 HTML 报告',
      '失败或取消的任务可以点「重试」重新执行，或点「编辑参数」调整配置',
    ],
  },
];

interface FaqItem {
  q: string;
  a: React.ReactNode;
}

const FAQS: FaqItem[] = [
  {
    q: '创建任务时为什么不能像以前那样设置 Temperature / Max Tokens / Top P？',
    a: (
      <Paragraph style={{ marginBottom: 0 }}>
        这些参数从「<Text strong>模型管理</Text>」中保存的默认生成配置继承，避免每次创建任务都要重复填。
        如果想用不同的生成参数测同一个模型，可以在「模型管理」复制一份模型并改名（如
        "GLM-4.7 高温"），保存不同的 temperature 即可。
      </Paragraph>
    ),
  },
  {
    q: '流式响应开关是干什么的？',
    a: (
      <Paragraph style={{ marginBottom: 0 }}>
        开启后，本次任务调用模型时会使用 SSE 流式接口（payload 中带 <Text code>stream: true</Text>）。
        某些模型在流式与非流式下的输出可能略有差异（特别是推理模型 reasoning_content），
        如果想精确还原线上服务的调用方式，可以开启。<Text type="secondary">作用范围仅限本任务，与模型管理里保存的配置无关。</Text>
      </Paragraph>
    ),
  },
  {
    q: '测试连接和实际评测的区别？',
    a: (
      <Paragraph style={{ marginBottom: 0 }}>
        「<Text strong>测试连接</Text>」只发一句固定 prompt（"你好，请用一句话回复。"），用来快速验证 API URL/Key 是否正确、网络是否可达；
        会返回完整的请求 payload 与响应 body，方便排查问题。
        而「<Text strong>评测任务</Text>」是真正用数据集里的题目跑模型，可能涉及成百上千次请求。
      </Paragraph>
    ),
  },
  {
    q: '任务卡在某个进度不动了怎么办？',
    a: (
      <Paragraph style={{ marginBottom: 0 }}>
        详情页有两种刷新机制并存：SSE 实时推送 + 5 秒兜底轮询。如果 5 秒后状态仍未变化，
        可以在「任务详情」查看日志找原因；如果确认卡死，先点「停止」再点「重试」。
        编程类（沙箱）数据集首次执行可能需要 10–30 秒等 Docker 启动，是正常的。
      </Paragraph>
    ),
  },
  {
    q: '数据集很多，怎么快速找到我想要的？',
    a: (
      <Paragraph style={{ marginBottom: 0 }}>
        「Benchmark 库」左侧的筛选面板按 4 个维度分组。比如想测中文数学能力，
        勾选「中文」+「数学」即可；想测代码能力，勾选「编程」并打开「需要沙箱」过滤出真正能跑代码的数据集。
        顶部搜索框也支持名称、描述、tag 的模糊匹配。
      </Paragraph>
    ),
  },
];

const Docs: React.FC = () => {
  const navigate = useNavigate();
  const [activeAnchor, setActiveAnchor] = useState('overview');

  return (
    <div style={{ position: 'relative' }}>
      <PageHeader
        icon={<ReadOutlined />}
        title="使用文档"
        subtitle="平台功能详解与使用流程指南"
      />

      <Row gutter={24}>
        {/* 左侧锚点导航 */}
        <Col xs={0} md={5} lg={4}>
          <div
            style={{
              position: 'sticky',
              top: 80,
              background: '#fff',
              borderRadius: 12,
              padding: 12,
              border: '1px solid #eef0f4',
              boxShadow: '0 1px 3px rgba(15,37,71,0.04)',
            }}
          >
            <Anchor
              affix={false}
              onChange={(link) => setActiveAnchor(link?.replace('#', '') || '')}
              getCurrentAnchor={() => `#${activeAnchor}`}
              items={[
                { key: 'overview', href: '#overview', title: '概览' },
                { key: 'flow', href: '#flow', title: '使用流程' },
                { key: 'features', href: '#features', title: '功能详解' },
                { key: 'tips', href: '#tips', title: '使用技巧' },
                { key: 'deploy', href: '#deploy', title: '部署运维' },
                { key: 'faq', href: '#faq', title: '常见问题' },
              ]}
            />
          </div>
        </Col>

        <Col xs={24} md={19} lg={20}>
          {/* ========== 概览 ========== */}
          <section id="overview" style={{ scrollMarginTop: 80 }}>
            <Card
              styles={{ body: { padding: 24 } }}
              style={{
                marginBottom: 20,
                borderRadius: 14,
                border: '1px solid #eef0f4',
                background:
                  'linear-gradient(135deg, rgba(24,144,255,0.06) 0%, rgba(146,84,222,0.06) 100%)',
              }}
            >
              <Space align="start" size={20}>
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 16,
                    background: 'linear-gradient(135deg, #1890ff 0%, #9254de 100%)',
                    color: '#fff',
                    fontSize: 30,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 10px 24px rgba(24,144,255,0.28)',
                    flexShrink: 0,
                  }}
                >
                  <RocketOutlined />
                </div>
                <div style={{ flex: 1 }}>
                  <Title level={4} style={{ margin: 0 }}>
                    EvalScope Workflow 是什么
                  </Title>
                  <Paragraph style={{ marginBottom: 8, color: '#4e5969' }}>
                    一个面向大模型的<Text strong>评测自动化工作流平台</Text>。围绕"模型 ·
                    数据集 · 指标"三个评测要素，把
                    <Text code>evalscope</Text>
                    、<Text code>opencompass</Text>、<Text code>vlmeval</Text>
                    等评测引擎包装成可视化的任务系统，让你能：
                  </Paragraph>
                  <Space size={8} wrap>
                    <Tag color="blue">配置一次，多次复用</Tag>
                    <Tag color="purple">156+ 内置 Benchmark</Tag>
                    <Tag color="cyan">实时进度 + 日志</Tag>
                    <Tag color="green">可视化报告</Tag>
                    <Tag color="orange">支持流式调用</Tag>
                  </Space>
                </div>
              </Space>
            </Card>
          </section>

          {/* ========== 使用流程 ========== */}
          <section id="flow" style={{ scrollMarginTop: 80, marginBottom: 24 }}>
            <Title level={4} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 4, height: 18, background: 'linear-gradient(180deg, #1890ff 0%, #9254de 100%)', borderRadius: 2 }} />
              使用流程
            </Title>
            <Paragraph type="secondary">从零到一发起第一次评测，只需要四步：</Paragraph>

            <Row gutter={[16, 16]}>
              {FLOW.map((step, idx) => (
                <Col key={idx} xs={24} md={12}>
                  <Card
                    styles={{ body: { padding: 18 } }}
                    style={{
                      borderRadius: 14,
                      border: '1px solid #eef0f4',
                      height: '100%',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    {/* 大数字 */}
                    <div
                      style={{
                        position: 'absolute',
                        right: -6,
                        top: -10,
                        fontSize: 96,
                        fontWeight: 800,
                        color: 'rgba(24,144,255,0.06)',
                        lineHeight: 1,
                        pointerEvents: 'none',
                      }}
                    >
                      {idx + 1}
                    </div>
                    <div style={{ position: 'relative' }}>
                      <Space align="start" size={12}>
                        <div
                          style={{
                            width: 38,
                            height: 38,
                            borderRadius: 10,
                            background: 'linear-gradient(135deg, #1890ff 0%, #9254de 100%)',
                            color: '#fff',
                            fontSize: 18,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {step.icon}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Text strong style={{ fontSize: 15 }}>
                            Step {idx + 1} · {step.title}
                          </Text>
                          <Paragraph style={{ margin: '4px 0 10px', fontSize: 13, color: '#5e6b7a' }}>
                            {step.desc}
                          </Paragraph>
                          <ul
                            style={{
                              margin: 0,
                              paddingLeft: 18,
                              fontSize: 12.5,
                              color: '#4e5969',
                              lineHeight: 1.7,
                            }}
                          >
                            {step.details.map((d, i) => (
                              <li key={i}>{d}</li>
                            ))}
                          </ul>
                          <Button
                            type="link"
                            size="small"
                            style={{ paddingLeft: 0, marginTop: 6 }}
                            onClick={() => navigate(step.link.path)}
                          >
                            {step.link.label} →
                          </Button>
                        </div>
                      </Space>
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>
          </section>

          {/* ========== 功能详解 ========== */}
          <section id="features" style={{ scrollMarginTop: 80, marginBottom: 24 }}>
            <Title level={4} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 4, height: 18, background: 'linear-gradient(180deg, #1890ff 0%, #9254de 100%)', borderRadius: 2 }} />
              功能详解
            </Title>
            <Paragraph type="secondary">
              侧边栏 7 个菜单分别承担不同职责，点击任意卡片可跳转到对应页面：
            </Paragraph>

            <Row gutter={[16, 16]}>
              {FEATURES.map((f) => (
                <Col key={f.path} xs={24} sm={12} lg={8}>
                  <Card
                    hoverable
                    onClick={() => navigate(f.path)}
                    styles={{ body: { padding: 18 } }}
                    style={{
                      borderRadius: 14,
                      border: '1px solid #eef0f4',
                      height: '100%',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 12,
                          background: f.gradient,
                          color: '#fff',
                          fontSize: 20,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: `0 6px 16px ${f.accent}33`,
                          flexShrink: 0,
                        }}
                      >
                        {f.icon}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <Text strong style={{ fontSize: 15, color: '#1f2d3d' }}>
                          {f.title}
                        </Text>
                        <div style={{ fontSize: 11, color: '#86909c', fontFamily: 'monospace' }}>
                          {f.path}
                        </div>
                      </div>
                    </div>
                    <Paragraph
                      style={{
                        marginBottom: 10,
                        fontSize: 12.5,
                        color: '#4e5969',
                        lineHeight: 1.6,
                      }}
                    >
                      {f.desc}
                    </Paragraph>
                    <Space size={4} wrap>
                      {f.tags.map((t) => (
                        <Tag key={t} color="default" style={{ fontSize: 11 }}>
                          {t}
                        </Tag>
                      ))}
                    </Space>
                  </Card>
                </Col>
              ))}
            </Row>
          </section>

          {/* ========== 使用技巧 ========== */}
          <section id="tips" style={{ scrollMarginTop: 80, marginBottom: 24 }}>
            <Title level={4} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 4, height: 18, background: 'linear-gradient(180deg, #1890ff 0%, #9254de 100%)', borderRadius: 2 }} />
              使用技巧
            </Title>

            <Row gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <Card
                  styles={{ body: { padding: 16 } }}
                  style={{ borderRadius: 12, border: '1px solid #eef0f4', height: '100%' }}
                >
                  <Space align="start">
                    <ThunderboltOutlined style={{ color: '#9254de', fontSize: 22 }} />
                    <div>
                      <Text strong>巧用「测试连接」</Text>
                      <Paragraph style={{ margin: '4px 0 0', fontSize: 13, color: '#5e6b7a' }}>
                        正式开跑前先在模型管理点一下「测试连接」。Modal 里会显示完整请求体、响应体、提取的回复，以及实际耗时——
                        既能验证 API 是否通畅，也能确认模型确实是你想要的那个版本。
                      </Paragraph>
                    </div>
                  </Space>
                </Card>
              </Col>
              <Col xs={24} md={12}>
                <Card
                  styles={{ body: { padding: 16 } }}
                  style={{ borderRadius: 12, border: '1px solid #eef0f4', height: '100%' }}
                >
                  <Space align="start">
                    <ExperimentOutlined style={{ color: '#52c41a', fontSize: 22 }} />
                    <div>
                      <Text strong>样本数限制是利器</Text>
                      <Paragraph style={{ margin: '4px 0 0', fontSize: 13, color: '#5e6b7a' }}>
                        第一次跑某个数据集时，把"样本数限制"设成 10 或 50，能在几十秒内拿到一个粗略结果，
                        快速验证 pipeline 是否通畅。确认无误后再放开跑全量。
                      </Paragraph>
                    </div>
                  </Space>
                </Card>
              </Col>
              <Col xs={24} md={12}>
                <Card
                  styles={{ body: { padding: 16 } }}
                  style={{ borderRadius: 12, border: '1px solid #eef0f4', height: '100%' }}
                >
                  <Space align="start">
                    <BulbOutlined style={{ color: '#fa8c16', fontSize: 22 }} />
                    <div>
                      <Text strong>模型保存多份配置</Text>
                      <Paragraph style={{ margin: '4px 0 0', fontSize: 13, color: '#5e6b7a' }}>
                        想对比"高温模式"和"低温模式"的同一模型？在模型管理里建两份配置，
                        显示名不同（如 GLM-4.7 / GLM-4.7-高温），同一 model_name 但不同 generation_config。
                        创建任务时分别选择即可独立对比。
                      </Paragraph>
                    </div>
                  </Space>
                </Card>
              </Col>
              <Col xs={24} md={12}>
                <Card
                  styles={{ body: { padding: 16 } }}
                  style={{ borderRadius: 12, border: '1px solid #eef0f4', height: '100%' }}
                >
                  <Space align="start">
                    <FileTextOutlined style={{ color: '#13c2c2', fontSize: 22 }} />
                    <div>
                      <Text strong>任务卡住先看日志</Text>
                      <Paragraph style={{ margin: '4px 0 0', fontSize: 13, color: '#5e6b7a' }}>
                        任务详情页底部「评测日志」每 3 秒自动刷新，会把 evalscope 的原始输出贴出来。
                        模型 API 报错、数据集加载失败、Docker 沙箱起不来——这些信息都在日志里。
                      </Paragraph>
                    </div>
                  </Space>
                </Card>
              </Col>
            </Row>
          </section>

          {/* ========== 部署运维 ========== */}
          <section id="deploy" style={{ scrollMarginTop: 80, marginBottom: 24 }}>
            <Title level={4} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 4, height: 18, background: 'linear-gradient(180deg, #1890ff 0%, #9254de 100%)', borderRadius: 2 }} />
              部署运维
            </Title>
            <Paragraph type="secondary">
              项目已 Docker 化，一行命令可在任意 Linux / macOS / WSL2 环境完整起服务。完整指南见仓库根目录 <Text code>DEPLOY.md</Text>。
            </Paragraph>

            <Card
              styles={{ body: { padding: 0 } }}
              style={{
                borderRadius: 14,
                border: '1px solid #eef0f4',
                overflow: 'hidden',
              }}
            >
              {/* 三步部署 */}
              <div style={{ padding: 20, borderBottom: '1px solid #f0f2f5' }}>
                <Text strong style={{ fontSize: 14, color: '#1f2d3d', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CloudServerOutlined style={{ color: '#1890ff' }} />
                  三步起服务
                </Text>
                <pre
                  style={{
                    margin: '12px 0 0',
                    padding: 14,
                    background: '#0f172a',
                    color: '#cbd5e1',
                    borderRadius: 10,
                    fontSize: 12.5,
                    lineHeight: 1.7,
                    fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, monospace",
                    overflow: 'auto',
                  }}
                >{`# 1. 准备配置
cp .env.example .env

# 2. 构建并启动
docker compose up -d --build

# 3. 访问
浏览器打开 http://<host>:5801`}</pre>
              </div>

              {/* 运维命令 */}
              <div style={{ padding: 20 }}>
                <Text strong style={{ fontSize: 14, color: '#1f2d3d' }}>
                  常用运维命令
                </Text>
                <Row gutter={[12, 12]} style={{ marginTop: 10 }}>
                  {[
                    { cmd: 'docker compose ps', desc: '查看服务运行状态' },
                    { cmd: 'docker compose logs -f backend', desc: '实时跟踪后端日志' },
                    { cmd: 'docker compose restart backend', desc: '只重启后端' },
                    { cmd: 'docker compose up -d --build', desc: '改了代码后热替换' },
                    { cmd: 'docker compose down', desc: '停止全部服务（保留数据）' },
                    { cmd: 'docker compose down -v && rm -rf data/', desc: '彻底清理（数据全删，慎用）' },
                  ].map((it) => (
                    <Col key={it.cmd} xs={24} md={12}>
                      <div
                        style={{
                          padding: '10px 12px',
                          borderRadius: 8,
                          background: '#f7f9fc',
                          border: '1px solid #eef0f4',
                          fontSize: 12,
                        }}
                      >
                        <code style={{ color: '#1890ff', fontFamily: 'monospace', display: 'block' }}>
                          {it.cmd}
                        </code>
                        <div style={{ color: '#86909c', marginTop: 4, fontSize: 11 }}>{it.desc}</div>
                      </div>
                    </Col>
                  ))}
                </Row>
              </div>

              {/* 数据持久化说明 */}
              <div style={{ padding: 20, background: '#f7f9fc', borderTop: '1px solid #f0f2f5' }}>
                <Text strong style={{ fontSize: 14, color: '#1f2d3d' }}>
                  数据持久化
                </Text>
                <Paragraph style={{ marginBottom: 8, marginTop: 8, fontSize: 13, color: '#4e5969' }}>
                  所有数据通过 volume 映射到仓库下 <Text code>data/</Text> 目录，重启 / 升级 / 删容器都不会丢：
                </Paragraph>
                <ul style={{ margin: 0, paddingLeft: 22, fontSize: 12.5, color: '#4e5969', lineHeight: 1.8 }}>
                  <li><Text code>data/db/</Text> — sqlite 数据库（任务、模型管理、配置）</li>
                  <li><Text code>data/outputs/</Text> — 评测产生的报告、日志、结果 JSON</li>
                  <li><Text code>data/datasets/</Text> — evalscope 下载的数据集缓存</li>
                </ul>
              </div>

              {/* 沙箱评测提示 */}
              <div style={{ padding: 16, background: 'rgba(250,140,22,0.06)', borderTop: '1px solid #f0f2f5' }}>
                <Space align="start">
                  <BulbOutlined style={{ color: '#fa8c16', fontSize: 18, marginTop: 2 }} />
                  <div style={{ fontSize: 12.5, color: '#4e5969', lineHeight: 1.6 }}>
                    <Text strong>沙箱评测</Text>：编程类数据集（need_sandbox=true）会调宿主 docker 起容器执行代码。
                    compose 默认已 mount <Text code>/var/run/docker.sock</Text>，不需要就在 <Text code>docker-compose.yml</Text> 注释掉这一行更安全。
                  </div>
                </Space>
              </div>
            </Card>
          </section>

          {/* ========== FAQ ========== */}
          <section id="faq" style={{ scrollMarginTop: 80, marginBottom: 16 }}>
            <Title level={4} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 4, height: 18, background: 'linear-gradient(180deg, #1890ff 0%, #9254de 100%)', borderRadius: 2 }} />
              常见问题
            </Title>

            <Collapse
              accordion
              ghost
              defaultActiveKey={['0']}
              items={FAQS.map((item, idx) => ({
                key: String(idx),
                label: (
                  <span style={{ fontSize: 14, fontWeight: 500 }}>
                    <QuestionCircleOutlined style={{ color: '#1890ff', marginRight: 8 }} />
                    {item.q}
                  </span>
                ),
                children: (
                  <div style={{ paddingLeft: 26, color: '#4e5969', fontSize: 13 }}>{item.a}</div>
                ),
              }))}
              style={{
                background: '#fff',
                borderRadius: 12,
                border: '1px solid #eef0f4',
                padding: 8,
              }}
            />
          </section>

          {/* 结尾 CTA */}
          <Card
            styles={{ body: { padding: 24 } }}
            style={{
              borderRadius: 14,
              border: 'none',
              background: 'linear-gradient(135deg, #1890ff 0%, #9254de 100%)',
              color: '#fff',
              marginTop: 24,
            }}
          >
            <Row align="middle" gutter={16}>
              <Col flex="auto">
                <Title level={4} style={{ color: '#fff', margin: 0 }}>
                  <CheckCircleOutlined style={{ marginRight: 8 }} />
                  准备好开跑了吗？
                </Title>
                <Paragraph style={{ color: 'rgba(255,255,255,0.85)', margin: '6px 0 0' }}>
                  先去模型管理把你的模型连上，再到 Benchmark 库挑一个数据集，5 分钟内可以发起第一次评测。
                </Paragraph>
              </Col>
              <Col>
                <Space>
                  <Button
                    size="large"
                    style={{ background: '#fff', border: 'none', color: '#1890ff', fontWeight: 600 }}
                    onClick={() => navigate('/models')}
                  >
                    去配置模型
                  </Button>
                  <Button
                    size="large"
                    ghost
                    onClick={() => navigate('/tasks/create')}
                  >
                    创建任务
                  </Button>
                </Space>
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default Docs;
