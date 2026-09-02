import { Input, Button } from 'antd';
import { SendOutlined, StopOutlined } from '@ant-design/icons';
import { useState } from 'react';

interface ChatInputProps {
  onSend: (content: string) => void;
  onStop: () => void;
  loading: boolean;
  disabled?: boolean;
}

const ChatInput: React.FC<ChatInputProps> = ({ onSend, onStop, loading, disabled }) => {
  const [value, setValue] = useState('');

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
      <Input.TextArea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入问题，按 Enter 发送..."
        autoSize={{ minRows: 1, maxRows: 4 }}
        disabled={disabled || loading}
        style={{ flex: 1, resize: 'none' }}
      />
      {loading ? (
        <Button
          type="default"
          danger
          icon={<StopOutlined />}
          onClick={onStop}
          style={{ flexShrink: 0 }}
        />
      ) : (
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          disabled={!value.trim() || disabled}
          style={{ flexShrink: 0 }}
        />
      )}
    </div>
  );
};

export default ChatInput;
