import type { ChatMessage } from '@/types';
import { CHAT_HISTORY_LIMIT, chatHistoryStorageKey, parseStoredChatHistory, isChatMessage } from '@/lib/chat-generation-lifecycle';
import { isResearchChatSkillId, type ResearchChatSkillId } from '@/lib/research-chat-skills';

export interface ChatHistoryDocument { messages: ChatMessage[]; draft: string; mode: ResearchChatSkillId | null }
export const emptyChatHistory = (): ChatHistoryDocument => ({ messages: [], draft: '', mode: null });
export function isChatHistoryDocument(value: unknown): value is ChatHistoryDocument {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ChatHistoryDocument>;
  return Array.isArray(item.messages) && item.messages.length <= CHAT_HISTORY_LIMIT && item.messages.every(isChatMessage)
    && typeof item.draft === 'string' && item.draft.length <= 100_000 && (item.mode === null || isResearchChatSkillId(item.mode));
}
export function legacyChatHistory(scopeKey: string): ChatHistoryDocument | null {
  try {
    const messages = parseStoredChatHistory(window.localStorage.getItem(chatHistoryStorageKey(scopeKey)));
    return messages.length ? { messages, draft: '', mode: null } : null;
  } catch { return null; }
}
