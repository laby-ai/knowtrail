import type { ChatGenerationStatus, ChatMessage } from '@/types';

export const CHAT_HISTORY_LIMIT = 100;
const CHAT_HISTORY_STORAGE_PREFIX = 'lingbi:chat-history:v1:';

type StreamEvent = Record<string, unknown>;

export type ChatStreamPayload =
  | { kind: 'done' }
  | { kind: 'ignore' }
  | { kind: 'error'; error: string }
  | { kind: 'event'; event: StreamEvent };

export function chatHistoryStorageKey(scopeKey: string): string {
  return `${CHAT_HISTORY_STORAGE_PREFIX}${encodeURIComponent(scopeKey.trim() || 'guest:default-workspace')}`;
}

export function createPendingAssistantMessage(id: string, question: string, timestamp: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: '',
    timestamp,
    generation: {
      status: 'pending',
      question: question.trim(),
      updatedAt: timestamp,
    },
  };
}

export function generationUpdate(
  status: ChatGenerationStatus,
  question: string,
  timestamp: string,
): Pick<ChatMessage, 'generation'> {
  return {
    generation: {
      status,
      question: question.trim(),
      updatedAt: timestamp,
    },
  };
}

export function findRetryTarget(
  messages: ChatMessage[],
  assistantMessageId?: string,
): { assistantMessageId: string; question: string } | null {
  const requestedIndex = assistantMessageId
    ? messages.findIndex((message) => message.id === assistantMessageId && message.role === 'assistant')
    : -1;
  const assistantIndex = requestedIndex >= 0
    ? requestedIndex
    : messages.findLastIndex((message) => message.role === 'assistant');
  if (assistantIndex < 0) return null;

  const assistant = messages[assistantIndex];
  const structuredQuestion = assistant.generation?.question?.trim();
  if (structuredQuestion) {
    return { assistantMessageId: assistant.id, question: structuredQuestion };
  }

  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate.role === 'user' && candidate.content.trim()) {
      return { assistantMessageId: assistant.id, question: candidate.content.trim() };
    }
  }
  return null;
}

export function classifyChatFailure({
  aborted,
  stoppedByUser,
  errorMessage = '',
}: {
  aborted: boolean;
  stoppedByUser: boolean;
  errorMessage?: string;
}): { status: Exclude<ChatGenerationStatus, 'pending' | 'completed'>; content: string } {
  if (stoppedByUser) {
    return { status: 'stopped', content: '已停止生成。可以换个问法继续提问。' };
  }
  if (aborted) {
    return {
      status: 'timeout',
      content: '真实模型生成超过 45 秒，已停止等待。请稍后重试，或把问题缩短为更具体的一问。',
    };
  }
  if (/额度|积分|充值|分配|预占|quota|billing/i.test(errorMessage)) {
    return { status: 'failed', content: '账号积分不足，请先充值，或联系管理员分配积分后再使用灵笔。' };
  }
  return { status: 'failed', content: '抱歉，AI 服务暂时不可用，请稍后重试。' };
}

export function parseChatStreamPayload(payload: string): ChatStreamPayload {
  if (payload === '[DONE]') return { kind: 'done' };
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'ignore' };
    const event = parsed as StreamEvent;
    if (typeof event.error === 'string' && event.error.trim()) {
      return { kind: 'error', error: event.error.trim() };
    }
    return { kind: 'event', event };
  } catch {
    return { kind: 'ignore' };
  }
}

export function serializeChatHistory(messages: ChatMessage[]): string {
  return JSON.stringify(messages.slice(-CHAT_HISTORY_LIMIT));
}

export function parseStoredChatHistory(raw: string | null): ChatMessage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isChatMessage).slice(-CHAT_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<ChatMessage>;
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) return false;
  if (!['user', 'assistant', 'system'].includes(candidate.role || '')) return false;
  if (typeof candidate.content !== 'string' || typeof candidate.timestamp !== 'string') return false;
  if (!candidate.generation) return true;
  return ['pending', 'completed', 'stopped', 'timeout', 'failed'].includes(candidate.generation.status)
    && typeof candidate.generation.updatedAt === 'string';
}
