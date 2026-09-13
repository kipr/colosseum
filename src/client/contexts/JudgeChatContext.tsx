import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  computeConversationUnread,
  computeHasUnread,
  getAdminSeenMap,
  getJudgeDisplayName,
  getJudgeLastSeen,
  mergeMessagesById,
  setAdminLastSeen,
  setJudgeDisplayName,
  setJudgeLastSeen,
} from '../utils/judgeChatUtils';
import {
  CHAT_PAGE_SIZE,
  chatConversationsQueryOptions,
  chatLatestQueryOptions,
  chatOlderKey,
  chatOlderQueryOptions,
  useDeleteChatConversationMutation,
  useSendChatMessageMutation,
  type ChatMessageScope,
} from '../queries/chat';
import { isAuthorizationError } from '../queries/authorization';
import type { JudgeChatConversation } from '../api/chat';

const EMPTY_CONVERSATIONS: JudgeChatConversation[] = [];

type JudgeChatProviderProps =
  | {
      children: ReactNode;
      eventId: number;
      mode: 'admin';
      userId: number;
    }
  | {
      children: ReactNode;
      eventId: number;
      mode: 'judge';
      sessionGeneration: string;
    };

function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
}

function useJudgeChatState(props: JudgeChatProviderProps) {
  const { eventId, mode } = props;
  const queryClient = useQueryClient();
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const [judgeName, setJudgeNameState] = useState<string | null>(() =>
    mode === 'judge' ? getJudgeDisplayName() : null,
  );
  const [selectedConversationKey, setSelectedConversationKey] = useState<
    string | null
  >(null);
  const [adminSeenMap, setAdminSeenMap] = useState<Record<string, number>>(() =>
    getAdminSeenMap(),
  );
  const [judgeLastSeen, setJudgeLastSeenState] = useState(() =>
    mode === 'judge' ? getJudgeLastSeen(eventId) : 0,
  );

  const userId = mode === 'admin' ? props.userId : 0;
  const sessionGeneration = mode === 'judge' ? props.sessionGeneration : '';
  const conversationsQuery = useQuery({
    ...chatConversationsQueryOptions(
      userId,
      eventId,
      mode === 'admin' && selectedConversationKey != null,
    ),
    enabled: mode === 'admin',
  });
  const conversations = isAuthorizationError(conversationsQuery.error)
    ? EMPTY_CONVERSATIONS
    : (conversationsQuery.data ?? EMPTY_CONVERSATIONS);

  const messageScope = useMemo<ChatMessageScope>(
    () =>
      mode === 'admin'
        ? {
            mode,
            userId,
            eventId,
            conversationKey: selectedConversationKey ?? '',
          }
        : { mode, sessionGeneration, eventId },
    [eventId, mode, selectedConversationKey, sessionGeneration, userId],
  );
  const messagesEnabled = mode === 'judge' || selectedConversationKey != null;
  const latestQuery = useQuery({
    ...chatLatestQueryOptions(
      messageScope,
      mode === 'judge' ? isDrawerOpen : selectedConversationKey != null,
    ),
    enabled: messagesEnabled,
  });
  const oldestLatestId = latestQuery.data?.[0]?.id;
  const olderQuery = useInfiniteQuery(
    chatOlderQueryOptions(messageScope, oldestLatestId),
  );

  const authorizationLost = isAuthorizationError(latestQuery.error);
  const latestIsAuthoritativelyEmpty =
    latestQuery.isSuccess && latestQuery.data.length === 0;
  const messages = useMemo(
    () =>
      authorizationLost || latestIsAuthoritativelyEmpty
        ? []
        : mergeMessagesById(
            ...(olderQuery.data?.pages ?? []),
            latestQuery.data ?? [],
          ),
    [
      authorizationLost,
      latestIsAuthoritativelyEmpty,
      latestQuery.data,
      olderQuery.data?.pages,
    ],
  );

  const sendMutation = useSendChatMessageMutation(mode === 'admin');
  const deleteMutation = useDeleteChatConversationMutation();
  const { fetchNextPage } = olderQuery;
  const { refetch: refetchConversations } = conversationsQuery;
  const { refetch: refetchLatest } = latestQuery;

  const setJudgeName = useCallback((name: string) => {
    setJudgeDisplayName(name);
    setJudgeNameState(name);
  }, []);

  useEffect(() => {
    if (
      latestQuery.isSuccess &&
      latestQuery.data.length === 0 &&
      messagesEnabled
    ) {
      queryClient.removeQueries({ queryKey: chatOlderKey(messageScope) });
    }
  }, [
    latestQuery.data,
    latestQuery.dataUpdatedAt,
    latestQuery.isSuccess,
    messageScope,
    messagesEnabled,
    queryClient,
  ]);

  useEffect(() => {
    if (
      mode === 'admin' &&
      conversationsQuery.isSuccess &&
      selectedConversationKey &&
      !conversations.some(
        (conversation) =>
          conversation.conversationKey === selectedConversationKey,
      )
    ) {
      setSelectedConversationKey(null);
    }
  }, [
    conversations,
    conversationsQuery.isSuccess,
    mode,
    selectedConversationKey,
  ]);

  const selectConversation = useCallback(
    (key: string | null) => {
      sendMutation.reset();
      setSelectedConversationKey(key);
    },
    [sendMutation],
  );

  useEffect(() => {
    if (mode !== 'judge' || !isDrawerOpen || messages.length === 0) return;
    const latestId = messages[messages.length - 1].id;
    if (latestId <= judgeLastSeen) return;
    setJudgeLastSeen(eventId, latestId);
    setJudgeLastSeenState(latestId);
  }, [eventId, isDrawerOpen, judgeLastSeen, messages, mode]);

  useEffect(() => {
    if (mode !== 'admin' || !selectedConversationKey || messages.length === 0) {
      return;
    }
    const summaryId = conversations.find(
      (conversation) =>
        conversation.conversationKey === selectedConversationKey,
    )?.lastMessageId;
    const latestId = Math.max(
      summaryId ?? 0,
      messages[messages.length - 1]?.id ?? 0,
    );
    if (latestId <= (adminSeenMap[selectedConversationKey] ?? 0)) return;
    setAdminLastSeen(selectedConversationKey, latestId);
    setAdminSeenMap(getAdminSeenMap());
  }, [adminSeenMap, conversations, messages, mode, selectedConversationKey]);

  const sendMessage = useCallback(
    async (message: string): Promise<boolean> => {
      sendMutation.reset();
      try {
        if (mode === 'admin') {
          const conversationKey = selectedConversationKey;
          if (!conversationKey) return false;
          await sendMutation.mutateAsync({
            mode,
            userId,
            eventId,
            conversationKey,
            message,
          });
        } else {
          await sendMutation.mutateAsync({
            mode,
            sessionGeneration,
            eventId,
            senderName: judgeName ?? 'Judge',
            message,
          });
        }
        return true;
      } catch {
        return false;
      }
    },
    [
      eventId,
      judgeName,
      mode,
      selectedConversationKey,
      sendMutation,
      sessionGeneration,
      userId,
    ],
  );

  const olderPages = olderQuery.data?.pages;
  const lastOlderPage = olderPages?.[olderPages.length - 1];
  const hasOlderMessages =
    messages.length > 0 &&
    (lastOlderPage
      ? lastOlderPage.length === CHAT_PAGE_SIZE
      : (latestQuery.data?.length ?? 0) >= CHAT_PAGE_SIZE);

  const loadOlderMessages = useCallback(async (): Promise<void> => {
    if (messages.length === 0 || !hasOlderMessages) return;
    await fetchNextPage();
  }, [fetchNextPage, hasOlderMessages, messages.length]);

  const deleteConversation = useCallback(
    async (conversationKey: string): Promise<boolean> => {
      if (mode !== 'admin') return false;
      try {
        await deleteMutation.mutateAsync({
          mode,
          userId,
          eventId,
          conversationKey,
        });
        setSelectedConversationKey((current) =>
          current === conversationKey ? null : current,
        );
        return true;
      } catch {
        return false;
      }
    },
    [deleteMutation, eventId, mode, userId],
  );

  const retryRead = useCallback(() => {
    if (mode === 'admin') void refetchConversations();
    if (messagesEnabled) void refetchLatest();
    if (olderQuery.isError) void fetchNextPage();
  }, [
    fetchNextPage,
    messagesEnabled,
    mode,
    olderQuery.isError,
    refetchConversations,
    refetchLatest,
  ]);

  const readError = errorMessage(
    conversationsQuery.error ?? latestQuery.error ?? olderQuery.error,
  );
  const conversationUnread = useCallback(
    (conversationKey: string, lastMessageId: number) =>
      computeConversationUnread(lastMessageId, conversationKey, adminSeenMap),
    [adminSeenMap],
  );

  return {
    isDrawerOpen,
    setDrawerOpen,
    judgeName,
    setJudgeName,
    needsNamePrompt: mode === 'judge' && !judgeName,
    messages,
    conversations,
    selectedConversationKey,
    setSelectedConversationKey: selectConversation,
    isLoading:
      conversationsQuery.isLoading ||
      (messagesEnabled && latestQuery.isLoading),
    isSending: sendMutation.isPending,
    sendError: errorMessage(sendMutation.error),
    readError,
    retryRead,
    hasUnread:
      mode === 'judge' && !isDrawerOpen
        ? computeHasUnread(messages, judgeLastSeen)
        : false,
    hasOlderMessages,
    isLoadingOlder: olderQuery.isFetchingNextPage,
    conversationUnread,
    sendMessage,
    loadOlderMessages,
    deleteConversation,
  };
}

const JudgeChatContext = createContext<
  ReturnType<typeof useJudgeChatState> | undefined
>(undefined);

export function JudgeChatProvider(props: JudgeChatProviderProps) {
  const value = useJudgeChatState(props);
  return (
    <JudgeChatContext.Provider value={value}>
      {props.children}
    </JudgeChatContext.Provider>
  );
}

export function useJudgeChat() {
  const context = useContext(JudgeChatContext);
  if (!context) {
    throw new Error('useJudgeChat must be used within JudgeChatProvider');
  }
  return context;
}
