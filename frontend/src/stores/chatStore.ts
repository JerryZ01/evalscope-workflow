import { create } from 'zustand';
import type { ManagedModelBrief } from '@/types';
import { chatApi, type ChatMessage, type ChatUsage, type ChatStreamCallbacks } from '@/api/chat';

// ---- 会话类型 ----

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  usage: ChatUsage;
  traceUrl?: string;
  createdAt: number;
  updatedAt: number;
}

// ---- 持久化 ----

const STORAGE_KEY = 'evalscope-chat-sessions';
const ACTIVE_SESSION_KEY = 'evalscope-chat-active-session';

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const sessions: ChatSession[] = JSON.parse(raw);
    // 兼容旧数据：补全缺失的 usage 字段
    return sessions.map((s) => ({
      ...s,
      usage: s.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }));
  } catch {
    return [];
  }
}

function saveSessions(sessions: ChatSession[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function loadActiveSessionId(): string | null {
  return localStorage.getItem(ACTIVE_SESSION_KEY);
}

function saveActiveSessionId(id: string | null) {
  if (id) {
    localStorage.setItem(ACTIVE_SESSION_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_SESSION_KEY);
  }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function inferTitle(messages: ChatMessage[]): string {
  // 取第一条用户消息的前 20 字符作为标题
  const first = messages.find((m) => m.role === 'user');
  if (!first) return '新对话';
  return first.content.length > 20 ? first.content.slice(0, 20) + '...' : first.content;
}

// ---- Store ----

interface ChatStore {
  // 会话
  sessions: ChatSession[];
  activeSessionId: string | null;
  messages: ChatMessage[];

  // 模型
  models: ManagedModelBrief[];
  selectedModelId: number | null;

  // 状态
  loading: boolean;
  error: string | null;

  // 会话操作
  createSession: () => string;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;

  // 消息操作
  sendMessage: (content: string) => Promise<void>;
  stopStreaming: () => void;
  clearMessages: () => void;

  // 模型操作
  setSelectedModel: (modelId: number) => void;
  fetchModels: () => Promise<void>;
}

let abortController: AbortController | null = null;

// 初始化：如果没有会话，自动创建一个
function initSessions(): { sessions: ChatSession[]; activeSessionId: string; messages: ChatMessage[] } {
  const sessions = loadSessions();
  const activeId = loadActiveSessionId();

  if (sessions.length === 0) {
    // 首次使用，自动创建第一个会话
    const now = Date.now();
    const id = generateId();
    const firstSession: ChatSession = {
      id,
      title: '新对话',
      messages: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      createdAt: now,
      updatedAt: now,
    };
    const newSessions = [firstSession];
    saveSessions(newSessions);
    saveActiveSessionId(id);
    return { sessions: newSessions, activeSessionId: id, messages: [] };
  }

  // 有历史会话，恢复活跃会话
  const validActiveId = activeId && sessions.find((s) => s.id === activeId) ? activeId : sessions[0].id;
  saveActiveSessionId(validActiveId);
  const active = sessions.find((s) => s.id === validActiveId)!;
  return { sessions, activeSessionId: validActiveId, messages: active.messages };
}

export const useChatStore = create<ChatStore>((set, get) => {
  const init = initSessions();
  return {
    sessions: init.sessions,
    activeSessionId: init.activeSessionId,
    messages: init.messages,
    models: [],
    selectedModelId: null,
    loading: false,
    error: null,

  // ---- 会话操作 ----

  createSession: () => {
    const id = generateId();
    const now = Date.now();
    const session: ChatSession = {
      id,
      title: '新对话',
      messages: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      createdAt: now,
      updatedAt: now,
    };
    const sessions = [session, ...get().sessions];
    saveSessions(sessions);
    saveActiveSessionId(id);
    set({ sessions, activeSessionId: id, messages: [] });
    return id;
  },

  switchSession: (id: string) => {
    const session = get().sessions.find((s) => s.id === id);
    if (!session) return;
    saveActiveSessionId(id);
    set({ activeSessionId: id, messages: session.messages });
  },

  deleteSession: (id: string) => {
    const { sessions, activeSessionId } = get();
    const newSessions = sessions.filter((s) => s.id !== id);

    if (newSessions.length === 0) {
      // 删完了，自动创建新会话
      saveSessions([]);
      const newId = get().createSession();
      return;
    }

    saveSessions(newSessions);

    if (activeSessionId === id) {
      const next = newSessions[0];
      saveActiveSessionId(next.id);
      set({
        sessions: newSessions,
        activeSessionId: next.id,
        messages: next.messages,
      });
    } else {
      set({ sessions: newSessions });
    }
  },

  // ---- 消息操作 ----

  sendMessage: async (content: string) => {
    const { messages, selectedModelId, loading, activeSessionId, sessions } = get();
    if (loading) return;

    // 如果没有活跃会话，自动创建
    let currentSessionId = activeSessionId;
    if (!currentSessionId) {
      currentSessionId = get().createSession();
    }

    const userMessage: ChatMessage = { role: 'user', content };
    const updatedMessages = [...messages, userMessage];
    set({ messages: updatedMessages, loading: true, error: null });

    const assistantMessage: ChatMessage = { role: 'assistant', content: '' };
    const messagesWithAssistant = [...updatedMessages, assistantMessage];
    set({ messages: messagesWithAssistant });

    // 持久化用户消息（不等助手回复完成）
    const now = Date.now();
    const updatedSessions = sessions.map((s) =>
      s.id === currentSessionId
        ? { ...s, messages: updatedMessages, title: inferTitle(updatedMessages), updatedAt: now }
        : s
    );
    saveSessions(updatedSessions);
    set({ sessions: updatedSessions });

    abortController = new AbortController();

    const callbacks: ChatStreamCallbacks = {
      onChunk: (chunk: string) => {
        set((state) => {
          const newMessages = [...state.messages];
          const lastIdx = newMessages.length - 1;
          if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
            newMessages[lastIdx] = {
              ...newMessages[lastIdx],
              content: newMessages[lastIdx].content + chunk,
            };
          }
          return { messages: newMessages };
        });
      },
      onDone: (usage?: ChatUsage, traceUrl?: string) => {
        // 持久化完整对话（含助手回复）+ 累积 usage
        const { messages: finalMessages, activeSessionId: sid, sessions: curSessions } = get();
        const now2 = Date.now();
        const finalSessions = curSessions.map((s) =>
          s.id === sid
            ? {
                ...s,
                messages: finalMessages,
                title: inferTitle(finalMessages),
                updatedAt: now2,
                usage: usage
                  ? {
                      prompt_tokens: s.usage.prompt_tokens + usage.prompt_tokens,
                      completion_tokens: s.usage.completion_tokens + usage.completion_tokens,
                      total_tokens: s.usage.total_tokens + usage.total_tokens,
                    }
                  : s.usage,
                traceUrl: traceUrl || s.traceUrl,
              }
            : s
        );
        saveSessions(finalSessions);
        set({ loading: false, sessions: finalSessions });
        abortController = null;
      },
      onError: (error: string) => {
        set((state) => {
          const newMessages = [...state.messages];
          const lastIdx = newMessages.length - 1;
          if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
            newMessages[lastIdx] = {
              ...newMessages[lastIdx],
              content: `[错误] ${error}`,
            };
          }
          // 持久化错误状态
          const now2 = Date.now();
          const finalSessions = state.sessions.map((s) =>
            s.id === state.activeSessionId
              ? { ...s, messages: newMessages, updatedAt: now2 }
              : s
          );
          saveSessions(finalSessions);
          return { messages: newMessages, loading: false, error, sessions: finalSessions };
        });
        abortController = null;
      },
    };

    const apiMessages = updatedMessages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      await chatApi.sendMessage(apiMessages, selectedModelId, callbacks, abortController.signal);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        callbacks.onError(err.message || '请求失败');
      }
    }
  },

  stopStreaming: () => {
    if (abortController) {
      abortController.abort();
      abortController = null;
      // 停止时也持久化当前内容
      const { messages, activeSessionId, sessions } = get();
      const now = Date.now();
      const updatedSessions = sessions.map((s) =>
        s.id === activeSessionId
          ? { ...s, messages, title: inferTitle(messages), updatedAt: now }
          : s
      );
      saveSessions(updatedSessions);
      set({ loading: false, sessions: updatedSessions });
    }
  },

  clearMessages: () => {
    const { activeSessionId, sessions } = get();
    if (!activeSessionId) {
      set({ messages: [], error: null });
      return;
    }
    const now = Date.now();
    const updatedSessions = sessions.map((s) =>
      s.id === activeSessionId
        ? { ...s, messages: [], title: '新对话', updatedAt: now }
        : s
    );
    saveSessions(updatedSessions);
    set({ messages: [], error: null, sessions: updatedSessions });
  },

  setSelectedModel: (modelId: number) => set({ selectedModelId: modelId }),

  fetchModels: async () => {
    try {
      const models = await chatApi.getModels();
      set({ models });
      const currentSelected = get().selectedModelId;
      if (!currentSelected && models.length > 0) {
        const defaultModel = models.find((m) => m.is_default);
        set({ selectedModelId: defaultModel?.id || models[0].id });
      }
    } catch (error: any) {
      set({ error: error.message });
    }
  },
  };
});
