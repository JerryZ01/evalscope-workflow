import type { ManagedModelBrief } from '@/types';
import client from './client';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatStreamCallbacks {
  onChunk: (content: string) => void;
  onDone: (usage?: ChatUsage, traceUrl?: string) => void;
  onError: (error: string) => void;
}

export const chatApi = {
  getModels: () =>
    client.get<ManagedModelBrief[]>('/models/brief', { params: { active_only: true } }),

  sendMessage: async (
    messages: ChatMessage[],
    modelId: number | null,
    callbacks: ChatStreamCallbacks,
    signal?: AbortSignal,
  ): Promise<void> => {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: modelId, messages }),
      signal,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: '请求失败' }));
      callbacks.onError(err.detail || '请求失败');
      return;
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const dataStr = trimmed.slice(6);
        try {
          const data = JSON.parse(dataStr);
          if (data.error) {
            callbacks.onError(data.error);
            return;
          }
          if (data.content) {
            callbacks.onChunk(data.content);
          }
          if (data.done) {
            callbacks.onDone(data.usage, data.trace_url);
            return;
          }
        } catch {
          // skip malformed JSON
        }
      }
    }
    callbacks.onDone();
  },
};

export type { ChatUsage };
