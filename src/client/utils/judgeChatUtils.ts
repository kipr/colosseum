import { formatDate } from './dateUtils';
import type { JudgeChatMessage } from '../api/chat';

export type { JudgeChatConversation, JudgeChatMessage } from '../api/chat';

export const JUDGE_CHAT_NAME_KEY = 'colosseum_judge_chat_name';
export const JUDGE_CHAT_ADMIN_SEEN_KEY = 'colosseum_judge_chat_admin_seen';

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function judgeLastSeenKey(eventId: number): string {
  return `colosseum_judge_chat_last_seen_${eventId}`;
}

export function getJudgeDisplayName(): string | null {
  const storage = getStorage();
  if (!storage) return null;
  return storage.getItem(JUDGE_CHAT_NAME_KEY);
}

export function setJudgeDisplayName(name: string): void {
  getStorage()?.setItem(JUDGE_CHAT_NAME_KEY, name);
}

export function getJudgeLastSeen(eventId: number): number {
  const storage = getStorage();
  if (!storage) return 0;
  const stored = storage.getItem(judgeLastSeenKey(eventId));
  return stored ? parseInt(stored, 10) : 0;
}

export function setJudgeLastSeen(eventId: number, messageId: number): void {
  getStorage()?.setItem(judgeLastSeenKey(eventId), String(messageId));
}

export function getAdminSeenMap(): Record<string, number> {
  const storage = getStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(JUDGE_CHAT_ADMIN_SEEN_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
}

export function setAdminLastSeen(
  conversationKey: string,
  messageId: number,
): void {
  const storage = getStorage();
  if (!storage) return;
  const map = getAdminSeenMap();
  map[conversationKey] = messageId;
  storage.setItem(JUDGE_CHAT_ADMIN_SEEN_KEY, JSON.stringify(map));
}

export function computeHasUnread(
  messages: JudgeChatMessage[],
  lastSeenId: number,
): boolean {
  if (messages.length === 0) return false;
  const latestId = Math.max(...messages.map((m) => m.id));
  return latestId > lastSeenId;
}

export function computeConversationUnread(
  lastMessageId: number,
  conversationKey: string,
  adminSeenMap: Record<string, number>,
): boolean {
  const lastSeen = adminSeenMap[conversationKey] ?? 0;
  return lastMessageId > lastSeen;
}

export function formatChatDate(dateString: string): string {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatRelativeActivity(
  dateString: string | null | undefined,
): string {
  if (!dateString) return '';

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(dateString);
}

export function truncatePreview(text: string | null, maxLen = 60): string {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

export function formatChatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function groupMessagesByDate(
  messages: JudgeChatMessage[],
): Record<string, JudgeChatMessage[]> {
  return messages.reduce(
    (groups, message) => {
      const date = formatChatDate(message.created_at);
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(message);
      return groups;
    },
    {} as Record<string, JudgeChatMessage[]>,
  );
}

/** Merge immutable message pages by id and return them chronologically. */
export function mergeMessagesById(
  ...pages: JudgeChatMessage[][]
): JudgeChatMessage[] {
  const byId = new Map<number, JudgeChatMessage>();
  for (const page of pages) {
    for (const message of page) {
      byId.set(message.id, message);
    }
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}
