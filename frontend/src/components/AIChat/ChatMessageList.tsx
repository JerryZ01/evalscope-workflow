import { useEffect, useRef } from 'react';
import { Typography, Spin } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage } from '@/api/chat';

interface ChatMessageListProps {
  messages: ChatMessage[];
  loading: boolean;
}

const ChatMessageList: React.FC<ChatMessageListProps> = ({ messages, loading }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  if (messages.length === 0) {
    return null;
  }

  return (
    <div ref={containerRef} className="ai-chat-messages">
      {messages.map((msg, idx) => (
        <div
          key={idx}
          style={{
            display: 'flex',
            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            marginBottom: 16,
          }}
        >
          <div
            style={{
              maxWidth: '75%',
              padding: '10px 16px',
              borderRadius: 12,
              fontSize: 14,
              lineHeight: 1.7,
              background: msg.role === 'user' ? '#1890ff' : '#f5f5f5',
              color: msg.role === 'user' ? '#fff' : 'rgba(0,0,0,0.85)',
              wordBreak: 'break-word',
            }}
          >
            {msg.role === 'assistant' ? (
              msg.content ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {msg.content}
                </ReactMarkdown>
              ) : loading && idx === messages.length - 1 ? (
                <Typography.Text type="secondary">
                  <Spin indicator={<LoadingOutlined style={{ fontSize: 14, marginRight: 6 }} />} />
                  思考中...
                </Typography.Text>
              ) : null
            ) : (
              msg.content
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default ChatMessageList;
