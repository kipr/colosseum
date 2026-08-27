import { z } from './schema';
import { coercedPositiveId, trimmedNonEmptyString } from './primitives';

export const JUDGE_CHAT_MESSAGE_MAX = 1000;
export const JUDGE_CHAT_SENDER_NAME_MAX = 30;

export const postChatMessageBodySchema = z
  .object({
    message: trimmedNonEmptyString.max(JUDGE_CHAT_MESSAGE_MAX),
    senderName: z.string().optional(),
    conversationKey: z.string().min(1).optional(),
  })
  .strict();

export const chatEventParamsSchema = z
  .object({
    eventId: coercedPositiveId,
  })
  .strict();

export const chatConversationParamsSchema = z
  .object({
    eventId: coercedPositiveId,
    conversationKey: z.string().min(1),
  })
  .strict();

export const postChatMessageRequest = {
  params: chatEventParamsSchema,
  body: postChatMessageBodySchema,
};

export const deleteChatConversationRequest = {
  params: chatConversationParamsSchema,
};
