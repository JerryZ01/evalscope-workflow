import { useEffect } from 'react';
import { Card, Select, Button, Typography, Space, Tooltip, List, Popconfirm } from 'antd';
import {
  RobotOutlined,
  DeleteOutlined,
  PlusOutlined,
  MessageOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '@/stores/chatStore';
import { ChatMessageList, ChatInput } from '@/components/AIChat';
import PageHeader from '@/components/common/PageHeader';

const QUICK_COMMANDS = [
  { label: '如何创建评测任务', prompt: '如何创建评测任务？' },
  { label: '如何配置模型 API', prompt: '如何配置模型的 API URL 和 API Key？' },
  { label: '支持哪些数据集', prompt: '平台支持哪些评测数据集？' },
  { label: '评测引擎有什么区别', prompt: 'Native、OpenCompass、VLMEval、RAGEval 这些评测引擎有什么区别？' },
  { label: '如何查看评测结果', prompt: '评测完成后如何查看结果和报告？' },
  { label: '断点续测怎么用', prompt: '断点续测功能怎么使用？' },
];

const AIChat: React.FC = () => {
  const {
    sessions, activeSessionId, messages, loading, models, selectedModelId,
    createSession, switchSession, deleteSession,
    setSelectedModel, clearMessages, stopStreaming, sendMessage, fetchModels,
  } = useChatStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (models.length === 0) {
      fetchModels();
    }
  }, []);

  const noModelsAvailable = models.length === 0;

  const handleNewSession = () => {
    createSession();
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  return (
    <div>
      <PageHeader
        icon={<RobotOutlined />}
        title="AI 助手"
        subtitle="评测平台使用指南"
        extra={
          <Space>
            <Select
              value={selectedModelId ?? undefined}
              onChange={setSelectedModel}
              style={{ width: 200 }}
              placeholder="选择模型"
              options={models.map((m) => ({
                label: `${m.name}${m.is_default ? ' (默认)' : ''}`,
                value: m.id,
              }))}
            />
          </Space>
        }
      />

      <div style={{ display: 'flex', gap: 12, height: 'calc(100vh - 160px)' }}>
        {/* 左侧会话列表 */}
        <Card
          style={{ width: 220, flexShrink: 0, overflow: 'hidden' }}
          styles={{ body: { padding: 0, height: '100%', display: 'flex', flexDirection: 'column' } }}
        >
          <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #f0f0f0' }}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              block
              onClick={handleNewSession}
              style={{ borderRadius: 6 }}
            >
              新对话
            </Button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <List
              dataSource={sessions}
              renderItem={(session) => (
                <List.Item
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    background: session.id === activeSessionId ? '#e6f7ff' : 'transparent',
                    borderLeft: session.id === activeSessionId ? '3px solid #1890ff' : '3px solid transparent',
                  }}
                  onClick={() => switchSession(session.id)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: session.id === activeSessionId ? 500 : 400,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <MessageOutlined style={{ marginRight: 6, color: '#8c8c8c' }} />
                      {session.title}
                    </div>
                    <div style={{ fontSize: 11, color: '#bfbfbf', marginTop: 2 }}>
                      {formatDate(session.updatedAt)}
                    </div>
                  </div>
                  <Popconfirm
                    title="删除此对话？"
                    onConfirm={(e) => {
                      e?.stopPropagation();
                      deleteSession(session.id);
                    }}
                    onCancel={(e) => e?.stopPropagation()}
                    okText="删除"
                    cancelText="取消"
                  >
                    <Button
                      type="text"
                      size="small"
                      icon={<DeleteOutlined />}
                      style={{ color: '#bfbfbf', flexShrink: 0 }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Popconfirm>
                </List.Item>
              )}
              locale={{ emptyText: '暂无对话' }}
            />
          </div>
        </Card>

        {/* 右侧对话区域 */}
        <Card
          style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
          styles={{
            body: {
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              padding: '0 20px 20px',
              overflow: 'hidden',
            },
          }}
        >
          {noModelsAvailable ? (
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
            }}>
              <RobotOutlined style={{ fontSize: 48, color: '#bfbfbf' }} />
              <Typography.Text type="secondary" style={{ fontSize: 16 }}>
                未配置模型，请先在模型管理中添加
              </Typography.Text>
              <Button type="primary" onClick={() => navigate('/models')}>
                前往模型管理
              </Button>
            </div>
          ) : (
            <>
              {/* 顶部操作栏 */}
              {messages.length > 0 && (
                <div style={{ padding: '8px 0', textAlign: 'right', flexShrink: 0 }}>
                  <Tooltip title="清空当前对话">
                    <Button size="small" icon={<DeleteOutlined />} onClick={clearMessages}>
                      清空
                    </Button>
                  </Tooltip>
                </div>
              )}

              {/* 消息区域 */}
              {messages.length === 0 ? (
                <div style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 32,
                }}>
                  <div style={{
                    width: 72,
                    height: 72,
                    borderRadius: 20,
                    background: 'linear-gradient(135deg, #1890ff 0%, #9254de 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 8px 24px rgba(24,144,255,0.3)',
                  }}>
                    <RobotOutlined style={{ fontSize: 36, color: '#fff' }} />
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 16 }}>
                    有什么关于平台使用的问题，可以问我
                  </Typography.Text>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 12,
                    maxWidth: 600,
                    width: '100%',
                  }}>
                    {QUICK_COMMANDS.map((cmd) => (
                      <Button
                        key={cmd.label}
                        onClick={() => sendMessage(cmd.prompt)}
                        style={{
                          textAlign: 'left',
                          height: 'auto',
                          whiteSpace: 'normal',
                          padding: '10px 14px',
                          borderRadius: 8,
                        }}
                      >
                        {cmd.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                <ChatMessageList messages={messages} loading={loading} />
              )}

              {/* 输入区域 */}
              <div style={{ flexShrink: 0 }}>
                {/* Token 用量统计 */}
                {(() => {
                  const currentSession = sessions.find((s) => s.id === activeSessionId);
                  const usage = currentSession?.usage;
                  const traceUrl = currentSession?.traceUrl;
                  if ((usage && usage.total_tokens > 0) || traceUrl) {
                    return (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 16,
                        padding: '6px 0',
                        fontSize: 11,
                        color: '#8c8c8c',
                      }}>
                        {usage && usage.total_tokens > 0 && (
                          <>
                            <span>Prompt: {usage.prompt_tokens.toLocaleString()}</span>
                            <span>Completion: {usage.completion_tokens.toLocaleString()}</span>
                            <span>Total: {usage.total_tokens.toLocaleString()}</span>
                          </>
                        )}
                        {traceUrl && (
                          <a
                            href={traceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: 11, color: '#1890ff' }}
                          >
                            Langfuse 追踪 →
                          </a>
                        )}
                      </div>
                    );
                  }
                  return null;
                })()}
                <div style={{ paddingTop: 8, borderTop: '1px solid #f0f0f0' }}>
                <ChatInput
                  onSend={sendMessage}
                  onStop={stopStreaming}
                  loading={loading}
                />
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
};

export default AIChat;
