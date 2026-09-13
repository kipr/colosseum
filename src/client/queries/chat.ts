import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  getChatConversations,
  getChatMessages,
  postChatMessage,
  removeChatConversation,
  type JudgeChatConversation,
  type JudgeChatMessage,
} from '../api/chat';
import { mergeMessagesById } from '../utils/judgeChatUtils';
import {
  adminChatConversationsKey,
  adminChatLatestKey,
  adminChatMessagesKey,
  adminChatOlderKey,
  judgeChatLatestKey,
  judgeChatOlderKey,
} from './keys';
import { ADMIN_ONLY_QUERY_META, canUpdateUserCache } from './invalidation';

export const CHAT_PAGE_SIZE = 100;
export const CHAT_ACTIVE_POLL_MS = 3_000;
export const CHAT_INACTIVE_POLL_MS = 15_000;
export type ChatMessageScope =
  | {
      mode: 'admin';
      userId: number;
      eventId: number;
      conversationKey: string;
    }
  | {
      mode: 'judge';
      sessionGeneration: string;
      eventId: number;
    };

export type SendChatMessageVariables =
  | (Extract<ChatMessageScope, { mode: 'admin' }> & { message: string })
  | (Extract<ChatMessageScope, { mode: 'judge' }> & {
      message: string;
      senderName: string;
    });

export interface DeleteChatConversationVariables {
  mode: 'admin';
  userId: number;
  eventId: number;
  conversationKey: string;
}

export function chatLatestKey(scope: ChatMessageScope) {
  return scope.mode === 'admin'
    ? adminChatLatestKey(scope.userId, scope.eventId, scope.conversationKey)
    : judgeChatLatestKey(scope.sessionGeneration, scope.eventId);
}

export function chatOlderKey(scope: ChatMessageScope) {
  return scope.mode === 'admin'
    ? adminChatOlderKey(scope.userId, scope.eventId, scope.conversationKey)
    : judgeChatOlderKey(scope.sessionGeneration, scope.eventId);
}

export function chatConversationsQueryOptions(
  userId: number,
  eventId: number,
  active: boolean,
) {
  return queryOptions<JudgeChatConversation[]>({
    queryKey: adminChatConversationsKey(userId, eventId),
    queryFn: ({ signal }) => getChatConversations(eventId, signal),
    refetchInterval: active ? CHAT_ACTIVE_POLL_MS : CHAT_INACTIVE_POLL_MS,
    meta: ADMIN_ONLY_QUERY_META,
  });
}

export function chatLatestQueryOptions(
  scope: ChatMessageScope,
  active: boolean,
) {
  return queryOptions<JudgeChatMessage[]>({
    queryKey: chatLatestKey(scope),
    queryFn: ({ signal }) =>
      getChatMessages(
        scope.eventId,
        {
          conversationKey:
            scope.mode === 'admin' ? scope.conversationKey : undefined,
          limit: CHAT_PAGE_SIZE,
        },
        signal,
      ),
    refetchInterval: active ? CHAT_ACTIVE_POLL_MS : CHAT_INACTIVE_POLL_MS,
    structuralSharing: (previous, next) => {
      const latest = next as JudgeChatMessage[];
      const previousMessages = (previous ?? []) as JudgeChatMessage[];
      return latest.length === 0
        ? []
        : mergeMessagesById(previousMessages, latest);
    },
    meta: scope.mode === 'admin' ? ADMIN_ONLY_QUERY_META : undefined,
  });
}

export function chatOlderQueryOptions(
  scope: ChatMessageScope,
  oldestLoadedId: number | undefined,
) {
  return infiniteQueryOptions({
    queryKey: chatOlderKey(scope),
    queryFn: ({ pageParam, signal }) =>
      getChatMessages(
        scope.eventId,
        {
          conversationKey:
            scope.mode === 'admin' ? scope.conversationKey : undefined,
          before: pageParam,
          limit: CHAT_PAGE_SIZE,
        },
        signal,
      ),
    initialPageParam: oldestLoadedId,
    getNextPageParam: (lastPage) =>
      lastPage.length === CHAT_PAGE_SIZE ? lastPage[0]?.id : undefined,
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    meta: scope.mode === 'admin' ? ADMIN_ONLY_QUERY_META : undefined,
  });
}

function insertSentMessage(
  client: QueryClient,
  scope: ChatMessageScope,
  message: JudgeChatMessage,
) {
  client.setQueryData<JudgeChatMessage[]>(chatLatestKey(scope), (current) =>
    mergeMessagesById(current ?? [], [message]),
  );
}

export function useSendChatMessageMutation(adminOnly: boolean) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: SendChatMessageVariables) =>
      postChatMessage(variables.eventId, {
        message: variables.message,
        conversationKey:
          variables.mode === 'admin' ? variables.conversationKey : undefined,
        senderName:
          variables.mode === 'judge' ? variables.senderName : undefined,
      }),
    onSuccess: async (message, variables) => {
      if (
        variables.mode === 'admin' &&
        !canUpdateUserCache(client, variables.userId, true)
      ) {
        return;
      }
      insertSentMessage(client, variables, message);
      if (variables.mode === 'admin') {
        await client.invalidateQueries({
          queryKey: adminChatConversationsKey(
            variables.userId,
            variables.eventId,
          ),
        });
      }
    },
    retry: 0,
    meta: adminOnly ? ADMIN_ONLY_QUERY_META : undefined,
  });
}

export function useDeleteChatConversationMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: DeleteChatConversationVariables) =>
      removeChatConversation(variables.eventId, variables.conversationKey),
    onSuccess: async (_data, variables) => {
      if (!canUpdateUserCache(client, variables.userId, true)) return;
      const messagePrefix = adminChatMessagesKey(
        variables.userId,
        variables.eventId,
        variables.conversationKey,
      );
      await client.cancelQueries({ queryKey: messagePrefix });
      client.removeQueries({ queryKey: messagePrefix });
      client.setQueryData<JudgeChatConversation[]>(
        adminChatConversationsKey(variables.userId, variables.eventId),
        (current) =>
          current?.filter(
            (conversation) =>
              conversation.conversationKey !== variables.conversationKey,
          ),
      );
      await client.invalidateQueries({
        queryKey: adminChatConversationsKey(
          variables.userId,
          variables.eventId,
        ),
      });
    },
    retry: 0,
    meta: ADMIN_ONLY_QUERY_META,
  });
}
