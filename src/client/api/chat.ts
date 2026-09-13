import { requestJson, requestJsonBody, requestVoid } from './http';

export interface JudgeChatMessage {
  id: number;
  event_id: number;
  conversation_key: string;
  sender_role: 'judge' | 'admin';
  sender_name: string;
  message: string;
  template_id: number | null;
  user_id: number | null;
  created_at: string;
}

export interface JudgeChatConversation {
  conversationKey: string;
  messageCount: number;
  lastMessageId: number;
  lastActivity: string;
  lastMessage: string | null;
  lastJudgeName: string | null;
}

export function getChatConversations(eventId: number, signal?: AbortSignal) {
  return requestJson<JudgeChatConversation[]>(
    `/chat/events/${eventId}/conversations`,
    { signal },
  );
}

export function getChatMessages(
  eventId: number,
  options: { conversationKey?: string; before?: number; limit?: number } = {},
  signal?: AbortSignal,
) {
  const search = new URLSearchParams();
  if (options.conversationKey) {
    search.set('conversationKey', options.conversationKey);
  }
  if (options.before != null) search.set('before', String(options.before));
  if (options.limit != null) search.set('limit', String(options.limit));
  const query = search.toString();
  return requestJson<JudgeChatMessage[]>(
    `/chat/events/${eventId}/messages${query ? `?${query}` : ''}`,
    { signal },
  );
}

export function postChatMessage(
  eventId: number,
  input: { message: string; conversationKey?: string; senderName?: string },
) {
  return requestJsonBody<JudgeChatMessage>(
    `/chat/events/${eventId}/messages`,
    'POST',
    input,
  );
}

export function removeChatConversation(
  eventId: number,
  conversationKey: string,
) {
  return requestVoid(
    `/chat/events/${eventId}/conversations/${encodeURIComponent(conversationKey)}`,
    { method: 'DELETE' },
  );
}
