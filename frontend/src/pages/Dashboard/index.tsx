import { Card, Row, Col, Tag, Spin, List, Typography, Button, Empty } from 'antd';
import {
  PlayCircleOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  DatabaseOutlined,
  ApiOutlined,
  DashboardOutlined,
  ArrowRightOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { taskApi } from '@/api/tasks';
import { catalogApi } from '@/api/catalog';
import type { Task } from '@/types';
import PageHeader from '@/components/common/PageHeader';

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  gradient: string;
  accent: string;
  hint?: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon, gradient, accent, hint }) => (
  <Card
    hoverable
    styles={{ body: { padding: 18 } }}
    style={{
      borderRadius: 14,
      border: '1px solid #eef0f4',
      background: '#fff',
      position: 'relative',
      overflow: 'hidden',
    }}
  >
    {/* 背景装饰 */}
    <div
      aria-hidden
      style={{
        position: 'absolute',
        top: -30,
        right: -30,
        width: 120,
        height: 120,
        borderRadius: '50%',
        background: gradient,
        opacity: 0.08,
      }}
    />
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 14 }}>
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          background: gradient,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: 22,
          boxShadow: `0 6px 18px ${accent}45`,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, color: '#86909c', fontWeight: 500, marginBottom: 4 }}>
          {label}
        </div>
        <div
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: '#1f2d3d',
            lineHeight: 1,
            fontFeatureSettings: '"tnum"',
          }}
        >
          {value}
        </div>
        {hint && (
          <div style={{ fontSize: 11, color: '#86909c', marginTop: 4 }}>{hint}</div>
        )}
      </div>
    </div>
  </Card>
);

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ datasets: 0, models: 6 });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [tasksData, datasetsData] = await Promise.all([
          taskApi.list({ limit: 10 }),
          catalogApi.getDatasets({ limit: 1 }),
        ]);
        setTasks(tasksData);
        setStats({
          datasets: (datasetsData as any).total || (datasetsData as any).length || 0,
          models: 6,
        });
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const counts = (() => {
    const c = { running: 0, completed: 0, pending: 0, failed: 0 };
    tasks.forEach((t) => {
      if (t.status in c) c[t.status as keyof typeof c]++;
    });
    return c;
  })();

  const getStatusTag = (status: string) => {
    const map: Record<string, { color: string; label: string }> = {
      running: { color: 'processing', label: '运行中' },
      completed: { color: 'success', label: '已完成' },
      pending: { color: 'default', label: '待执行' },
      failed: { color: 'error', label: '失败' },
      cancelled: { color: 'default', label: '已取消' },
    };
    const m = map[status] || { color: 'default', label: status };
    return (
      <Tag color={m.color} style={{ borderRadius: 999, padding: '2px 10px', fontWeight: 500 }}>
        {m.label}
      </Tag>
    );
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        icon={<DashboardOutlined />}
        title="仪表盘"
        subtitle="一览任务运行状态、资源情况与最近活动"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/tasks/create')}
          >
            创建任务
          </Button>
        }
      />

      {/* 状态统计 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            label="运行中"
            value={counts.running}
            icon={<PlayCircleOutlined />}
            gradient="linear-gradient(135deg, #1890ff 0%, #096dd9 100%)"
            accent="#1890ff"
            hint={counts.running > 0 ? '正在评测' : '当前无任务在运行'}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            label="已完成"
            value={counts.completed}
            icon={<CheckCircleOutlined />}
            gradient="linear-gradient(135deg, #52c41a 0%, #389e0d 100%)"
            accent="#52c41a"
            hint="可查看评测报告"
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            label="待执行"
            value={counts.pending}
            icon={<ClockCircleOutlined />}
            gradient="linear-gradient(135deg, #faad14 0%, #fa8c16 100%)"
            accent="#faad14"
            hint={counts.pending > 0 ? '等待手动启动' : '队列为空'}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            label="失败"
            value={counts.failed}
            icon={<CloseCircleOutlined />}
            gradient="linear-gradient(135deg, #ff4d4f 0%, #cf1322 100%)"
            accent="#ff4d4f"
            hint={counts.failed > 0 ? '点击查看详情' : '无失败任务'}
          />
        </Col>
      </Row>

      {/* 资源统计 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} md={12}>
          <Card
            hoverable
            onClick={() => navigate('/catalog')}
            styles={{ body: { padding: 20 } }}
            style={{ borderRadius: 14, border: '1px solid #eef0f4' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, #9254de 0%, #722ed1 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 6px 18px rgba(146,84,222,0.28)',
                }}
              >
                <DatabaseOutlined style={{ fontSize: 24, color: '#fff' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#86909c', marginBottom: 4, fontWeight: 500 }}>
                  Benchmark 数据集
                </div>
                <div
                  style={{
                    fontSize: 26,
                    fontWeight: 700,
                    color: '#1f2d3d',
                    lineHeight: 1,
                    fontFeatureSettings: '"tnum"',
                  }}
                >
                  {stats.datasets}
                </div>
              </div>
              <ArrowRightOutlined style={{ color: '#86909c', fontSize: 14 }} />
            </div>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card
            hoverable
            onClick={() => navigate('/models')}
            styles={{ body: { padding: 20 } }}
            style={{ borderRadius: 14, border: '1px solid #eef0f4' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, #1890ff 0%, #096dd9 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 6px 18px rgba(24,144,255,0.28)',
                }}
              >
                <ApiOutlined style={{ fontSize: 24, color: '#fff' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#86909c', marginBottom: 4, fontWeight: 500 }}>
                  支持模型类型
                </div>
                <div
                  style={{
                    fontSize: 26,
                    fontWeight: 700,
                    color: '#1f2d3d',
                    lineHeight: 1,
                    fontFeatureSettings: '"tnum"',
                  }}
                >
                  {stats.models}
                </div>
              </div>
              <ArrowRightOutlined style={{ color: '#86909c', fontSize: 14 }} />
            </div>
          </Card>
        </Col>
      </Row>

      {/* 最近任务 */}
      <Card
        styles={{ body: { padding: 0 }, header: { padding: '14px 20px', borderBottom: '1px solid #f0f2f5' } }}
        style={{ borderRadius: 14, border: '1px solid #eef0f4' }}
        title={
          <span style={{ fontSize: 15, fontWeight: 600, color: '#1f2d3d' }}>最近任务</span>
        }
        extra={
          <Typography.Link onClick={() => navigate('/tasks')} style={{ fontWeight: 500 }}>
            查看全部 <ArrowRightOutlined style={{ fontSize: 11 }} />
          </Typography.Link>
        }
      >
        {tasks.length === 0 ? (
          <div style={{ padding: 40 }}>
            <Empty
              description="暂无任务"
              imageStyle={{ height: 60 }}
            >
              <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/tasks/create')}>
                创建第一个任务
              </Button>
            </Empty>
          </div>
        ) : (
          <List
            dataSource={tasks}
            renderItem={(task) => (
              <List.Item
                style={{
                  padding: '14px 20px',
                  borderBottom: '1px solid #f5f7fa',
                  transition: 'background 0.2s',
                  cursor: 'pointer',
                }}
                onClick={() => navigate(`/tasks/${task.id}`)}
                actions={[
                  <Typography.Link
                    key="view"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/tasks/${task.id}`);
                    }}
                  >
                    详情 <ArrowRightOutlined style={{ fontSize: 11 }} />
                  </Typography.Link>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <span style={{ fontWeight: 600, color: '#1f2d3d', fontSize: 14 }}>
                      {task.name}
                    </span>
                  }
                  description={
                    <div style={{ color: '#86909c', fontSize: 12, display: 'flex', gap: 18 }}>
                      <span>
                        模型 <Tag color="blue" style={{ marginInlineStart: 4 }}>{task.model_name}</Tag>
                      </span>
                      <span>
                        数据集{' '}
                        {task.datasets.slice(0, 2).map((d) => (
                          <Tag key={d} color="purple" style={{ marginInlineStart: 4 }}>
                            {d}
                          </Tag>
                        ))}
                        {task.datasets.length > 2 && (
                          <Tag>+{task.datasets.length - 2}</Tag>
                        )}
                      </span>
                    </div>
                  }
                />
                {getStatusTag(task.status)}
              </List.Item>
            )}
          />
        )}
      </Card>
    </div>
  );
};

export default Dashboard;
