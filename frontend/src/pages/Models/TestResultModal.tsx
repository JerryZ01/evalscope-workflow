import { Modal, Tag, Tooltip, Typography, Collapse, Empty, Button } from 'antd';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  ClockCircleOutlined,
  ThunderboltOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import type { ConnectionTestResult } from '@/api/models';

interface Props {
  open: boolean;
  loading: boolean;
  modelName?: string;
  result: ConnectionTestResult | null;
  onClose: () => void;
  onRetry?: () => void;
}

const JsonBlock: React.FC<{ value: any; maxHeight?: number }> = ({ value, maxHeight = 280 }) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  };
  return (
    <div style={{ position: 'relative' }}>
      <pre
        style={{
          margin: 0,
          padding: 12,
          background: '#0f172a',
          color: '#cbd5e1',
          borderRadius: 10,
          fontSize: 12,
          lineHeight: 1.6,
          fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",
          maxHeight,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {text || '(空)'}
      </pre>
      <Tooltip title="复制">
        <Button
          size="small"
          type="text"
          icon={<CopyOutlined />}
          onClick={handleCopy}
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            color: '#94a3b8',
            background: 'rgba(255,255,255,0.06)',
          }}
        />
      </Tooltip>
    </div>
  );
};

const TestResultModal: React.FC<Props> = ({ open, loading, modelName, result, onClose, onRetry }) => {
  const success = result?.success;
  const accent = success ? '#52c41a' : '#ff4d4f';
  const statusTone = success ? 'rgba(82,196,26,0.12)' : 'rgba(255,77,79,0.12)';

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <span style={{ fontSize: 16, fontWeight: 600 }}>
          <ThunderboltOutlined style={{ color: '#1890ff', marginRight: 8 }} />
          连接测试 {modelName && <Typography.Text type="secondary" style={{ fontWeight: 400, fontSize: 13 }}>· {modelName}</Typography.Text>}
        </span>
      }
      width={760}
      footer={[
        onRetry && (
          <Button key="retry" icon={<ThunderboltOutlined />} onClick={onRetry} loading={loading}>
            再测一次
          </Button>
        ),
        <Button key="close" type="primary" onClick={onClose}>
          关闭
        </Button>,
      ].filter(Boolean)}
      destroyOnClose
    >
      {loading && !result ? (
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <ThunderboltOutlined spin style={{ fontSize: 32, color: '#1890ff' }} />
          <div style={{ marginTop: 12, color: '#86909c' }}>正在调用模型 API…</div>
        </div>
      ) : !result ? (
        <Empty description="无结果" />
      ) : (
        <div>
          {/* 顶部状态摘要 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 16px',
              background: statusTone,
              border: `1px solid ${accent}33`,
              borderRadius: 12,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: accent,
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                flexShrink: 0,
              }}
            >
              {success ? <CheckCircleFilled /> : <CloseCircleFilled />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: accent }}>
                {success ? '连接成功' : '连接失败'}
              </div>
              <div style={{ fontSize: 12, color: '#5e6b7a', marginTop: 2, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span>
                  <ClockCircleOutlined /> {result.latency_ms} ms
                </span>
                <span>
                  模式: <Tag color={result.stream ? 'purple' : 'blue'} style={{ marginInlineStart: 2 }}>
                    {result.stream ? '流式 (stream)' : '非流式'}
                  </Tag>
                </span>
                {result.response?.status_code && (
                  <span>
                    HTTP <Tag color={success ? 'success' : 'error'} style={{ marginInlineStart: 2 }}>{result.response.status_code}</Tag>
                  </span>
                )}
                {result.response?.chunks_count != null && (
                  <span>chunks: <strong>{result.response.chunks_count}</strong></span>
                )}
              </div>
              {result.error && (
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 12,
                    color: '#cf1322',
                    background: 'rgba(255,77,79,0.06)',
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: '1px solid rgba(255,77,79,0.18)',
                    wordBreak: 'break-all',
                  }}
                >
                  {result.error}
                </div>
              )}
            </div>
          </div>

          {/* 提取到的回复（最重要） */}
          {result.response?.content && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ width: 3, height: 14, background: '#1890ff', borderRadius: 2 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1f2d3d' }}>模型回复</span>
              </div>
              <div
                style={{
                  background: 'linear-gradient(135deg, #f0f7ff 0%, #f5f0ff 100%)',
                  border: '1px solid #d6e4ff',
                  borderRadius: 10,
                  padding: '12px 14px',
                  fontSize: 14,
                  color: '#1f2d3d',
                  lineHeight: 1.65,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {result.response.content}
              </div>
            </div>
          )}

          {/* 请求 / 响应详情 */}
          <Collapse
            ghost
            defaultActiveKey={[success ? 'response' : 'request', 'response']}
            items={[
              {
                key: 'request',
                label: (
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    <Tag color="blue">{result.request?.method || 'POST'}</Tag>
                    请求详情
                  </span>
                ),
                children: result.request ? (
                  <div>
                    <div style={{ fontSize: 12, color: '#5e6b7a', marginBottom: 8 }}>
                      <strong>URL：</strong>
                      <span style={{ fontFamily: 'monospace', color: '#1f2d3d' }}>
                        {result.request.url}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#5e6b7a', marginBottom: 6 }}>
                      <strong>Headers</strong>
                    </div>
                    <JsonBlock value={result.request.headers} maxHeight={120} />
                    <div style={{ fontSize: 12, color: '#5e6b7a', margin: '10px 0 6px' }}>
                      <strong>Body</strong>
                    </div>
                    <JsonBlock value={result.request.payload} maxHeight={220} />
                  </div>
                ) : (
                  <Empty description="无请求记录" />
                ),
              },
              {
                key: 'response',
                label: (
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    <Tag color={success ? 'success' : 'error'}>
                      {result.response?.status_code ?? '—'}
                    </Tag>
                    响应详情
                  </span>
                ),
                children: result.response ? (
                  <div>
                    <div style={{ fontSize: 12, color: '#5e6b7a', marginBottom: 6 }}>
                      <strong>Response Headers</strong>
                    </div>
                    <JsonBlock value={result.response.headers} maxHeight={120} />
                    <div style={{ fontSize: 12, color: '#5e6b7a', margin: '10px 0 6px' }}>
                      <strong>{result.response.raw ? 'Raw（流式聚合前）' : 'Body'}</strong>
                    </div>
                    <JsonBlock
                      value={result.response.raw ?? result.response.body ?? ''}
                      maxHeight={320}
                    />
                  </div>
                ) : (
                  <Empty description="无响应" />
                ),
              },
            ]}
          />
        </div>
      )}
    </Modal>
  );
};

export default TestResultModal;
