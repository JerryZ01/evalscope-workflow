import { Table, Button, Space, Tag, Popconfirm, Card, Input, Progress } from 'antd';
import { PlusOutlined, EyeOutlined, DeleteOutlined, PlayCircleOutlined, StopOutlined, SearchOutlined, RedoOutlined, ReloadOutlined, UnorderedListOutlined } from '@ant-design/icons';
import PageHeader from '@/components/common/PageHeader';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTaskStore } from '@/stores';
import { workflowApi } from '@/api/workflow';
import { taskApi } from '@/api/tasks';
import type { Task, TaskStatus, WorkflowStatus } from '@/types';
import dayjs from 'dayjs';

const TaskList: React.FC = () => {
  const navigate = useNavigate();
  const { tasks, loading, fetchTasks, deleteTask, stopTask, retryTask } = useTaskStore();
  const [searchText, setSearchText] = useState('');
  // 记录正在执行操作的任务 ID 集合，操作中的任务按钮显示加载状态
  const [actioningTasks, setActioningTasks] = useState<Set<number>>(new Set());
  const [workflowStatusMap, setWorkflowStatusMap] = useState<Record<number, WorkflowStatus>>({});

  useEffect(() => {
    fetchTasks({ limit: 50 });
  }, []);

  // 对 pending 任务批量查询工作流状态
  useEffect(() => {
    const pendingTasks = tasks.filter(t => t.status === 'pending');
    if (pendingTasks.length === 0) return;
    Promise.allSettled(
      pendingTasks.map(t => workflowApi.getStatus(t.id))
    ).then(results => {
      const map: Record<number, WorkflowStatus> = {};
      results.forEach((result, i) => {
        if (result.status === 'fulfilled' && result.value.waiting_for_confirmation) {
          map[pendingTasks[i].id] = result.value;
        }
      });
      setWorkflowStatusMap(map);
    });
  }, [tasks]);

  const getEffectiveStatus = (task: Task): TaskStatus => {
    if (task.status === 'pending' && workflowStatusMap[task.id]?.waiting_for_confirmation) {
      return 'confirming';
    }
    return task.status;
  };

  // 辅助函数：标记任务正在操作中
  const setTaskActioning = (taskId: number, isActioning: boolean) => {
    setActioningTasks(prev => {
      const next = new Set(prev);
      if (isActioning) {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }
      return next;
    });
  };

  const handleDelete = async (taskId: number) => {
    setTaskActioning(taskId, true);
    try {
      await deleteTask(taskId);
    } catch (error) {
      console.error('Failed to delete task:', error);
    } finally {
      setTaskActioning(taskId, false);
    }
  };

  const handleRetry = async (taskId: number) => {
    setTaskActioning(taskId, true);
    try {
      await retryTask(taskId);
      await workflowApi.start(taskId);
      navigate(`/tasks/${taskId}`);
    } catch (error) {
      console.error('Failed to retry task:', error);
      await fetchTasks({ limit: 50 });
    } finally {
      setTaskActioning(taskId, false);
    }
  };

  const handleResume = async (taskId: number) => {
    setTaskActioning(taskId, true);
    try {
      await taskApi.resume(taskId);
      await workflowApi.start(taskId);
      navigate(`/tasks/${taskId}`);
    } catch (error) {
      console.error('Failed to resume task:', error);
      await fetchTasks({ limit: 50 });
    } finally {
      setTaskActioning(taskId, false);
    }
  };

  const handleStart = async (taskId: number) => {
    setTaskActioning(taskId, true);
    try {
      await workflowApi.start(taskId);
      navigate(`/tasks/${taskId}`);
    } catch (error) {
      console.error('Failed to start task:', error);
      await fetchTasks({ limit: 50 });
    } finally {
      setTaskActioning(taskId, false);
    }
  };

  const handleStop = async (taskId: number) => {
    setTaskActioning(taskId, true);
    try {
      await stopTask(taskId);
      await fetchTasks({ limit: 50 });
    } catch (error) {
      console.error('Failed to stop task:', error);
      await fetchTasks({ limit: 50 });
    } finally {
      setTaskActioning(taskId, false);
    }
  };

  const getStatusTag = (status: TaskStatus) => {
    const config: Record<string, { color: string; label: string; bg: string }> = {
      pending: { color: '#8c8c8c', label: '待执行', bg: 'rgba(140,140,140,0.1)' },
      confirming: { color: '#faad14', label: '等待确认', bg: 'rgba(250,173,20,0.1)' },
      running: { color: '#1890ff', label: '运行中', bg: 'rgba(24,144,255,0.1)' },
      completed: { color: '#52c41a', label: '已完成', bg: 'rgba(82,196,26,0.1)' },
      failed: { color: '#ff4d4f', label: '失败', bg: 'rgba(255,77,79,0.1)' },
      cancelled: { color: '#8c8c8c', label: '已取消', bg: 'rgba(140,140,140,0.1)' },
    };
    const { color, label, bg } = config[status] || { color: '#8c8c8c', label: status, bg: 'rgba(0,0,0,0.05)' };
    return (
      <Tag
        style={{
          color,
          background: bg,
          border: 'none',
          borderRadius: 12,
          padding: '4px 12px',
          fontWeight: 500,
        }}
      >
        {label}
      </Tag>
    );
  };

  const filteredTasks = tasks.filter((task) =>
    task.name.toLowerCase().includes(searchText.toLowerCase()) ||
    task.model_name.toLowerCase().includes(searchText.toLowerCase())
  );

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 60,
      render: (text: number, record: Task) => (
        <a
          onClick={() => navigate(`/tasks/${record.id}`)}
          style={{
            fontWeight: 600,
            color: '#1890ff',
          }}
        >
          #{text}
        </a>
      ),
    },
    {
      title: '任务名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Task) => (
        <a
          onClick={() => navigate(`/tasks/${record.id}`)}
          style={{
            fontWeight: 600,
            color: '#1a1a2e',
            fontSize: 14,
          }}
        >
          {text}
        </a>
      ),
    },
    {
      title: '模型',
      dataIndex: 'model_name',
      key: 'model_name',
      render: (text: string) => (
        <span style={{
          color: '#1890ff',
          fontWeight: 500,
          background: 'rgba(24,144,255,0.08)',
          padding: '4px 10px',
          borderRadius: 8,
        }}>
          {text}
        </span>
      ),
    },
    {
      title: '数据集',
      dataIndex: 'datasets',
      key: 'datasets',
      render: (datasets: string[]) => (
        <span style={{ color: '#9254de' }}>
          {datasets.join(', ')}
        </span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (_status: TaskStatus, record: Task) => getStatusTag(getEffectiveStatus(record)),
    },
    {
      title: '进度',
      dataIndex: 'progress',
      key: 'progress',
      render: (progress: number, record: Task) => (
        <div style={{ width: 100 }}>
          <Progress
            percent={progress}
            size="small"
            status={record.status === 'failed' ? 'exception' : record.status === 'completed' ? 'success' : 'active'}
            strokeColor={record.status === 'completed' ? '#52c41a' : record.status === 'failed' ? '#ff4d4f' : '#1890ff'}
          />
        </div>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (text: string) => (
        <span style={{ color: '#8c8c8c', fontSize: 13 }}>
          {dayjs(text).format('YYYY-MM-DD HH:mm')}
        </span>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: Task) => {
        const isActioning = actioningTasks.has(record.id);
        const effectiveStatus = getEffectiveStatus(record);

        return (
          <Space size={8}>
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => navigate(`/tasks/${record.id}`)}
              style={{ color: '#1890ff' }}
            >
              查看
            </Button>

            {isActioning ? (
              <Button
                type="text"
                size="small"
                loading
                disabled
                style={{ color: '#8c8c8c' }}
              >
                处理中...
              </Button>
            ) : (
              <>
                {effectiveStatus === 'pending' && (
                  <Button
                    type="text"
                    size="small"
                    icon={<PlayCircleOutlined />}
                    onClick={() => handleStart(record.id)}
                    style={{ color: '#52c41a' }}
                  >
                    启动
                  </Button>
                )}
                {effectiveStatus === 'confirming' && (
                  <Button
                    type="text"
                    size="small"
                    icon={<EyeOutlined />}
                    onClick={() => navigate(`/tasks/${record.id}`)}
                    style={{ color: '#d48806' }}
                  >
                    查看并确认
                  </Button>
                )}
                {effectiveStatus === 'running' && (
                  <>
                    <Button
                      type="text"
                      size="small"
                      icon={<StopOutlined />}
                      onClick={() => handleStop(record.id)}
                      style={{ color: '#ff4d4f' }}
                    >
                      停止
                    </Button>
                    <Popconfirm
                      title="确定要删除这个任务吗？"
                      onConfirm={() => handleDelete(record.id)}
                      okText="确定"
                      cancelText="取消"
                    >
                      <Button type="text" size="small" icon={<DeleteOutlined />} style={{ color: '#ff4d4f' }}>
                        删除
                      </Button>
                    </Popconfirm>
                  </>
                )}
                {(effectiveStatus === 'failed' || effectiveStatus === 'cancelled') && (
                  <>
                    <Button
                      type="text"
                      size="small"
                      icon={<ReloadOutlined />}
                      onClick={() => handleResume(record.id)}
                      style={{ color: '#52c41a' }}
                    >
                      续测
                    </Button>
                    <Button
                      type="text"
                      size="small"
                      icon={<RedoOutlined />}
                      onClick={() => handleRetry(record.id)}
                      style={{ color: '#1890ff' }}
                    >
                      重试
                    </Button>
                  </>
                )}
                {effectiveStatus === 'completed' && (
                  <Button
                    type="text"
                    size="small"
                    icon={<RedoOutlined />}
                    onClick={() => handleRetry(record.id)}
                    style={{ color: '#1890ff' }}
                  >
                    重试
                  </Button>
                )}
                {effectiveStatus !== 'running' && effectiveStatus !== 'confirming' && (
                  <Popconfirm
                    title="确定要删除这个任务吗？"
                    onConfirm={() => handleDelete(record.id)}
                    okText="确定"
                    cancelText="取消"
                  >
                    <Button type="text" size="small" icon={<DeleteOutlined />} style={{ color: '#ff4d4f' }}>
                      删除
                    </Button>
                  </Popconfirm>
                )}
              </>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        icon={<UnorderedListOutlined />}
        title="任务列表"
        subtitle="查看与管理所有评测任务"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/tasks/create')}>
            创建任务
          </Button>
        }
      />

      <Card
        style={{ borderRadius: 14, border: '1px solid #eef0f4' }}
        styles={{ body: { padding: 16 } }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
          <Input
            placeholder="搜索任务名称或模型..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
            allowClear
            style={{ width: 320 }}
          />
        </div>

        <Table
          columns={columns}
          dataSource={filteredTasks}
          rowKey="id"
          loading={loading}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 个任务`,
          }}
        />
      </Card>
    </div>
  );
};

export default TaskList;
