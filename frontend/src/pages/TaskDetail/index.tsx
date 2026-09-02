import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Row, Col, Statistic, Progress, Spin, Tag, Button, Space, Descriptions, message, Empty, Popconfirm, Alert } from 'antd';
import { PlayCircleOutlined, StopOutlined, ArrowLeftOutlined, ReloadOutlined, DeleteOutlined, RedoOutlined, EditOutlined, CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { useTaskStore } from '@/stores';
import { resultsApi } from '@/api/results';
import { workflowApi } from '@/api/workflow';
import type { VisualizationData, WorkflowStatus } from '@/types';
import { Column, Radar } from '@ant-design/plots';
import EditTaskModal from './EditTaskModal';

const TaskDetail: React.FC = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const { currentTask, fetchTask, stopTask, deleteTask, retryTask, loading, setCurrentTask } = useTaskStore();

  const [vizData, setVizData] = useState<VisualizationData | null>(null);
  const [vizLoading, setVizLoading] = useState(false);
  const [taskLogs, setTaskLogs] = useState<string>("");
  const [actualCommand, setActualCommand] = useState<string>("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportKey, setReportKey] = useState(0);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus | null>(null);
  const [confirming, setConfirming] = useState(false);

  // SSE 连接引用
  const eventSourceRef = useRef<EventSource | null>(null);
  // 日志容器引用（用于自动滚动）
  const logContainerRef = useRef<HTMLPreElement | null>(null);
  // SSE 连接状态引用（避免闭包捕获过期值）
  const sseConnectedRef = useRef(false);
  // 工作流状态轮询定时器
  const pollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (taskId) {
      // 立即清空旧任务，避免显示其他任务的内容
      setCurrentTask(null);
      fetchTask(Number(taskId));
    }
  }, [taskId]);

  useEffect(() => {
    if (currentTask?.status === 'completed' && taskId) {
      loadVisualization();
      loadReportHtml();
    }
  }, [currentTask?.status, taskId]);

  // 查询工作流状态（pending 任务可能正在等待确认）
  useEffect(() => {
    if (currentTask?.status === 'pending' && taskId) {
      workflowApi.getStatus(Number(taskId)).then(status => {
        setWorkflowStatus(status);
        if (status.waiting_for_confirmation) {
          startWorkflowPolling(Number(taskId));
        }
      }).catch(() => {
        setWorkflowStatus(null);
      });
    }
    return () => stopWorkflowPolling();
  }, [currentTask?.status, taskId]);

  // 计算 UI 有效状态
  const effectiveStatus = currentTask?.status === 'pending' && workflowStatus?.waiting_for_confirmation
    ? 'confirming' as const
    : currentTask?.status;

  const startWorkflowPolling = (id: number) => {
    if (pollingTimerRef.current) return;
    pollingTimerRef.current = setInterval(async () => {
      try {
        const status = await workflowApi.getStatus(id);
        setWorkflowStatus(status);
        if (!status.waiting_for_confirmation) {
          stopWorkflowPolling();
          fetchTask(id);
        }
      } catch (e) {
        console.error('工作流状态轮询失败:', e);
      }
    }, 3000);
  };

  const stopWorkflowPolling = () => {
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
  };

  // 建立 SSE 连接
  const connectSSE = useCallback(() => {
    if (!taskId || eventSourceRef.current) {
      console.log('connectSSE: 跳过连接, taskId:', taskId, '已有连接:', !!eventSourceRef.current);
      return;
    }

    const taskIdNum = Number(taskId);
    console.log('connectSSE: 建立连接, taskId:', taskIdNum);
    const eventSource = new EventSource(`/api/eval/stream/${taskIdNum}`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      sseConnectedRef.current = true;
      console.log('SSE: 连接已打开');
    };

    // 连接成功事件
    eventSource.addEventListener('connected', (event) => {
      console.log('SSE: 连接成功事件:', event.data);
    });

    // 进度更新事件
    eventSource.addEventListener('progress', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('SSE 进度更新:', data);

        // 更新当前任务状态
        if (currentTask) {
          setCurrentTask({
            ...currentTask,
            progress: data.progress,
            current_step: data.current_step,
            status: data.status
          });
        }
      } catch (e) {
        console.error('SSE: 解析进度事件失败:', e);
      }
    });

    // 日志增量事件
    eventSource.addEventListener('logs', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.incremental && data.logs) {
          setTaskLogs(prev => prev + data.logs);
          // 自动滚动到底部
          setTimeout(() => {
            logContainerRef.current?.scrollTo({ top: logContainerRef.current.scrollHeight });
          }, 50);
        }
      } catch (e) {
        console.error('SSE: 解析日志事件失败:', e);
      }
    });

    // 任务完成事件
    eventSource.addEventListener('complete', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('SSE 任务完成:', data);

        // 刷新任务详情
        fetchTask(taskIdNum);

        if (data.status === 'completed') {
          message.success('任务已完成');
        } else if (data.status === 'failed') {
          message.error('任务执行失败');
        }
      } catch (e) {
        console.error('SSE: 解析完成事件失败:', e);
      }
    });

    // 心跳事件
    eventSource.addEventListener('heartbeat', () => {
      // console.log('Heartbeat received');
    });

    eventSource.onerror = (error) => {
      console.error('SSE: 连接错误:', error);
      sseConnectedRef.current = false;
      // 断开重连
      eventSource.close();
      eventSourceRef.current = null;
      // 5秒后重连
      setTimeout(() => {
        if (currentTask?.status === 'running') {
          connectSSE();
        }
      }, 5000);
    };

  }, [taskId, currentTask?.status]);

  // 根据任务状态管理 SSE 连接
  useEffect(() => {
    if (!taskId || !currentTask) return;

    // 运行中的任务建立 SSE 连接
    if (effectiveStatus === 'running') {
      connectSSE();
    }

    // 加载日志（仅在首次进入或状态切换时）
    loadLogs(true);

    return () => {
      // 清理 SSE 连接
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      sseConnectedRef.current = false;
    };
  }, [taskId, effectiveStatus]);

  // 加载日志
  const loadLogs = async (forceFullUpdate: boolean = false) => {
    if (!taskId) return;
    setLogsLoading(true);
    try {
      const response = await fetch(`/api/eval/log/${taskId}`);
      const data = await response.json();
      setActualCommand(data.actual_command || "");
      const logs = data.logs || "";
      // forceFullUpdate=true 时强制覆盖（如手动刷新、初始加载）
      // SSE 连接时用全量日志做同步（避免增量丢失），未连接时也全量覆盖
      if (forceFullUpdate || !sseConnectedRef.current) {
        setTaskLogs(logs);
      } else {
        // SSE 已连接：如果服务端日志比当前显示的长，说明有增量丢失，用全量补齐
        setTaskLogs(prev => {
          if (logs.length > prev.length) {
            return logs;
          }
          return prev;
        });
      }
      // 加载全量日志后滚动到底部
      if (forceFullUpdate) {
        setTimeout(() => {
          logContainerRef.current?.scrollTo({ top: logContainerRef.current.scrollHeight });
        }, 50);
      }
    } catch (error) {
      console.error("loadLogs: 加载失败:", error);
    } finally {
      setLogsLoading(false);
    }
  };

  const loadVisualization = async () => {
    if (!taskId) return;
    setVizLoading(true);
    try {
      const data = await resultsApi.getVisualization(Number(taskId));
      setVizData(data);
    } catch (error) {
      console.error('Failed to load visualization:', error);
    } finally {
      setVizLoading(false);
    }
  };

  const loadReportHtml = async () => {
    if (!taskId) return;
    setReportLoading(true);
    try {
      const response = await fetch(`/api/eval/report/${taskId}`);
      const data = await response.json();
      if (data.exists !== false) {
        // 更新 key 强制重新加载 iframe
        setReportKey(k => k + 1);
      }
    } catch (error) {
      console.error('Failed to load report:', error);
    } finally {
      setReportLoading(false);
    }
  };

  const handleStart = async () => {
    if (!taskId) return;
    try {
      await workflowApi.start(Number(taskId));
      message.info('工作流已启动，正在准备配置...');
      const status = await workflowApi.getStatus(Number(taskId));
      setWorkflowStatus(status);
      if (status.waiting_for_confirmation) {
        startWorkflowPolling(Number(taskId));
      }
      fetchTask(Number(taskId));
    } catch (error: any) {
      message.error(error.message || '启动失败');
    }
  };

  const handleConfirm = async () => {
    if (!taskId) return;
    setConfirming(true);
    try {
      await workflowApi.confirm(Number(taskId));
      stopWorkflowPolling();
      setWorkflowStatus(null);
      message.success('评测已开始执行');
      fetchTask(Number(taskId));
    } catch (error: any) {
      message.error(error.message || '确认失败');
    } finally {
      setConfirming(false);
    }
  };

  const handleCancelWorkflow = async () => {
    if (!taskId) return;
    try {
      await workflowApi.cancel(Number(taskId));
      stopWorkflowPolling();
      setWorkflowStatus(null);
      message.success('工作流已取消');
      fetchTask(Number(taskId));
    } catch (error: any) {
      message.error(error.message || '取消失败');
    }
  };

  const handleStop = async () => {
    if (!taskId) return;
    try {
      await stopTask(Number(taskId));
      message.success('任务已停止');
      fetchTask(Number(taskId));
      // 停止后加载日志
      loadLogs(true);
    } catch (error: any) {
      message.error(error.message || '停止失败');
    }
  };

  const handleStopAndDelete = async () => {
    if (!taskId) return;
    try {
      await stopTask(Number(taskId));
      await deleteTask(Number(taskId));
      message.success('任务已停止并删除');
      navigate('/tasks');
    } catch (error: any) {
      message.error(error.message || '操作失败');
    }
  };

  const handleDelete = async () => {
    if (!taskId) return;
    try {
      await deleteTask(Number(taskId));
      message.success('任务已删除');
      navigate('/tasks');
    } catch (error: any) {
      message.error(error.message || '删除失败');
    }
  };

  const handleRetry = async () => {
    if (!taskId) return;
    try {
      await retryTask(Number(taskId));
      await workflowApi.start(Number(taskId));
      const status = await workflowApi.getStatus(Number(taskId));
      setWorkflowStatus(status);
      if (status.waiting_for_confirmation) {
        startWorkflowPolling(Number(taskId));
      }
      message.info('工作流已重新启动');
      fetchTask(Number(taskId));
    } catch (error: any) {
      message.error(error.message || '重试失败');
      fetchTask(Number(taskId));
    }
  };

  const getStatusTag = (status: string) => {
    const config: Record<string, { color: string; label: string }> = {
      pending: { color: 'default', label: '待执行' },
      confirming: { color: 'warning', label: '等待确认' },
      running: { color: 'processing', label: '运行中' },
      completed: { color: 'success', label: '已完成' },
      failed: { color: 'error', label: '失败' },
      cancelled: { color: 'default', label: '已取消' },
    };
    const { color, label } = config[status] || { color: 'default', label: status };
    return <Tag color={color}>{label}</Tag>;
  };

  if (loading || !currentTask) {
    return <Spin size="large" />;
  }

  // 渲染雷达图
  const renderRadarChart = () => {
    if (!vizData?.radar?.length) return null;
    const data = vizData.radar.map((item) => ({
      metric: item.metric,
      score: item.score * 100,
    }));
    const config = {
      data,
      xField: 'metric',
      yField: 'score',
      meta: { score: { min: 0, max: 100 } },
      area: { style: { fill: '#1890ff', opacity: 0.3 } },
      point: { shapeField: 'circle', sizeField: 4 },
      axis: {
        x: { line: null },
        y: { label: false, grid: true },
      },
    };
    return <Radar {...config} />;
  };

  // 渲染柱状图
  const renderBarChart = () => {
    if (!vizData?.categories?.length) return null;
    const data = vizData.categories.map((item) => ({
      category: item.name,
      score: item.score * 100,
      num: item.num,
    }));
    const config = {
      data,
      xField: 'score',
      yField: 'category',
      colorField: 'category',
      label: {
        position: 'right',
        text: (d: any) => `${(d.score).toFixed(1)}% (${d.num}样本)`,
      },
      style: {
        radiusTopLeft: 4,
        radiusTopRight: 4,
        radiusBottomLeft: 4,
        radiusBottomRight: 4,
      },
    };
    return <Column {...config} />;
  };

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/tasks')}>
          返回列表
        </Button>
        {effectiveStatus === 'pending' && (
          <>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={handleStart}
            >
              启动
            </Button>
            <Button
              icon={<EditOutlined />}
              onClick={() => navigate(`/tasks/${taskId}/edit`)}
            >
              编辑参数
            </Button>
            <Popconfirm
              title="确定要删除这个任务吗？"
              onConfirm={handleDelete}
              okText="确定"
              cancelText="取消"
            >
              <Button danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </>
        )}
        {effectiveStatus === 'running' && (
          <>
            <Button
              danger
              icon={<StopOutlined />}
              onClick={handleStop}
            >
              停止
            </Button>
            <Popconfirm
              title="确定要停止并删除这个任务吗？"
              description="此操作不可恢复"
              onConfirm={handleStopAndDelete}
              okText="确定"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button danger icon={<DeleteOutlined />}>
                停止并删除
              </Button>
            </Popconfirm>
          </>
        )}
        {effectiveStatus === 'completed' && (
          <Popconfirm
            title="确定要删除这个任务吗？"
            onConfirm={handleDelete}
            okText="确定"
            cancelText="取消"
          >
            <Button danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        )}
        {(effectiveStatus === 'failed' || effectiveStatus === 'cancelled') && (
          <>
            <Button
              type="primary"
              icon={<RedoOutlined />}
              onClick={handleRetry}
            >
              重试
            </Button>
            <Button
              icon={<EditOutlined />}
              onClick={() => navigate(`/tasks/${taskId}/edit`)}
            >
              编辑参数
            </Button>
            <Popconfirm
              title="确定要删除这个任务吗？"
              onConfirm={handleDelete}
              okText="确定"
              cancelText="取消"
            >
              <Button danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </>
        )}
      </Space>

      {/* 等待确认：显示配置摘要 */}
      {effectiveStatus === 'confirming' && (
        <Card
          title={
            <Space>
              <ExclamationCircleOutlined style={{ color: '#d48806' }} />
              <span style={{ color: '#874d00' }}>人工确认：评测配置</span>
            </Space>
          }
          extra={<Tag color="warning">LangGraph 已中断</Tag>}
          style={{
            marginBottom: 16,
            borderColor: '#faad14',
            background: '#fffbe6',
            borderLeft: '4px solid #faad14',
          }}
        >
          <pre style={{
            whiteSpace: 'pre-wrap',
            fontFamily: 'inherit',
            margin: 0,
            color: '#595959',
            fontSize: 14,
            lineHeight: 1.8,
          }}>
            {workflowStatus?.config_summary || [
              `模型: ${currentTask.model_name}`,
              `数据集: ${currentTask.datasets.join(', ')}`,
              `引擎: ${currentTask.engine || 'native'}`,
              currentTask.limit ? `样本限制: ${currentTask.limit}` : '',
            ].filter(Boolean).join('\n')}
          </pre>
          {workflowStatus?.current_step && (
            <div style={{ marginTop: 8, color: '#8c8c8c', fontSize: 13 }}>
              当前步骤: {workflowStatus.current_step}
            </div>
          )}
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #ffe58f' }}>
            <Space wrap>
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                onClick={handleConfirm}
                loading={confirming}
              >
                确认执行
              </Button>
              <Popconfirm
                title="确定要取消此工作流吗？"
                onConfirm={handleCancelWorkflow}
                okText="确定"
                cancelText="取消"
              >
                <Button danger icon={<CloseCircleOutlined />}>
                  取消
                </Button>
              </Popconfirm>
              <Button
                icon={<EditOutlined />}
                onClick={() => setEditModalOpen(true)}
              >
                修改参数
              </Button>
            </Space>
          </div>
        </Card>
      )}

      {/* 失败诊断结果 */}
      {effectiveStatus === 'failed' && workflowStatus?.diagnosis && (
        <Alert
          type="error"
          showIcon
          message="诊断结果"
          description={workflowStatus.diagnosis}
          style={{ marginBottom: 16 }}
        />
      )}

      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col flex="auto">
            <h2>{currentTask.name}</h2>
            <Space>
              {getStatusTag(effectiveStatus || 'pending')}
              <span>模型: {currentTask.model_name}</span>
              <span>数据集: {currentTask.datasets.join(', ')}</span>
            </Space>
          </Col>
          <Col>
            <Progress
              type="circle"
              percent={currentTask.progress}
              status={effectiveStatus === 'failed' ? 'exception' : undefined}
            />
          </Col>
        </Row>
        {currentTask.current_step && (
          <div style={{ marginTop: 16 }}>
            <span>当前步骤: {currentTask.current_step}</span>
          </div>
        )}
      </Card>

      {/* 任务配置 - 所有状态都显示 */}
      <Card
        title="任务配置"
        style={{ marginBottom: 16 }}
        extra={
          <Button size="small" icon={<EditOutlined />} onClick={() => setEditModalOpen(true)}>
            编辑参数
          </Button>
        }
      >
        <Descriptions column={2} size="small" bordered>
          <Descriptions.Item label="任务名称" span={2}>{currentTask.name}</Descriptions.Item>
          <Descriptions.Item label="模型名称">{currentTask.model_name}</Descriptions.Item>
          <Descriptions.Item label="模型类型">{currentTask.model_type}</Descriptions.Item>
          <Descriptions.Item label="API URL">{currentTask.model_url || '-'}</Descriptions.Item>
          <Descriptions.Item label="评测引擎">{currentTask.engine || 'native'}</Descriptions.Item>
          <Descriptions.Item label="数据集" span={2}>{currentTask.datasets.join(', ')}</Descriptions.Item>
          <Descriptions.Item label="样本数限制">{currentTask.limit || '全部'}</Descriptions.Item>
          <Descriptions.Item label="评测批次">{currentTask.eval_batch_size || 1}</Descriptions.Item>
          <Descriptions.Item label="Temperature">{currentTask.generation_config?.temperature ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="Max Tokens">{currentTask.generation_config?.max_tokens ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="Top P">{currentTask.generation_config?.top_p ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="Top K">{currentTask.generation_config?.top_k ?? '-'}</Descriptions.Item>
        </Descriptions>
      </Card>

      {currentTask.status === 'completed' && (
        <Spin spinning={vizLoading}>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={8}>
              <Card>
                <Statistic
                  title="总体评分"
                  value={vizData?.overview.score ? (vizData.overview.score * 100).toFixed(2) : 0}
                  suffix="%"
                  valueStyle={{ color: '#1890ff', fontSize: 32 }}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card>
                <Statistic
                  title="评测样本数"
                  value={vizData?.overview.total_samples || 0}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card>
                <Statistic
                  title="耗时"
                  value={vizData?.overview.duration ? (vizData.overview.duration / 60).toFixed(1) : 0}
                  suffix="分钟"
                />
              </Card>
            </Col>
          </Row>

          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={12}>
              <Card title="指标雷达图">{renderRadarChart()}</Card>
            </Col>
            <Col span={12}>
              <Card title="类别分布">{renderBarChart()}</Card>
            </Col>
          </Row>

          {vizData?.analysis && (
            <Card title="AI 分析报告" style={{ marginBottom: 16 }}>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                {vizData.analysis}
              </pre>
            </Card>
          )}

          {/* 可视化报告 */}
          {currentTask.status === 'completed' && (
            <Card
              title="可视化报告"
              style={{ marginBottom: 16 }}
              extra={
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={loadReportHtml}
                  loading={reportLoading}
                >
                  刷新
                </Button>
              }
            >
              <iframe
                key={reportKey}
                src={`/api/eval/report/${taskId}`}
                title="评测报告"
                style={{
                  width: '100%',
                  height: 600,
                  border: 'none',
                  backgroundColor: '#fff'
                }}
              />
            </Card>
          )}
        </Spin>
      )}

      {currentTask.status === 'failed' && currentTask.logs && (
        <Card title="错误日志">
          <pre style={{ whiteSpace: 'pre-wrap', color: '#ff4d4f' }}>
            {currentTask.logs}
          </pre>
        </Card>
      )}

      {/* 评测配置命令 */}
      {actualCommand && (
        <Card
          title="评测配置命令"
          style={{ marginTop: 16 }}
          extra={
            <Button
              size="small"
              onClick={() => {
                navigator.clipboard.writeText(actualCommand);
                message.success('命令已复制到剪贴板');
              }}
            >
              复制命令
            </Button>
          }
        >
          <pre style={{
            background: '#001529',
            color: '#52c41a',
            padding: 16,
            borderRadius: 4,
            fontSize: 13,
            fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
            overflow: 'auto',
          }}>
            {actualCommand}
          </pre>
        </Card>
      )}

      {/* 评测日志 - 所有状态都显示 */}
      {effectiveStatus !== 'pending' && effectiveStatus !== 'confirming' && (
        <Card
          title="评测日志"
          style={{ marginTop: 16 }}
          extra={
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => loadLogs(true)}
              loading={logsLoading}
            >
              刷新
            </Button>
          }
        >
          {taskLogs ? (
            <pre ref={logContainerRef} style={{
              maxHeight: 500,
              overflow: 'auto',
              background: '#f5f5f5',
              padding: 12,
              borderRadius: 4,
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}>
              {taskLogs}
            </pre>
          ) : (
            <Empty description="暂无日志" />
          )}
        </Card>
      )}

      <EditTaskModal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        taskId={taskId || ''}
      />
    </div>
  );
};

export default TaskDetail;
