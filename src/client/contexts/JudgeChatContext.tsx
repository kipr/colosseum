import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
  useRef,
} from 'react';
import {
  JudgeChatMessage,
  JudgeChatConversation,
  getJudgeDisplayName,
  setJudgeDisplayName,
  getJudgeLastSeen,
  setJudgeLastSeen,
  getAdminSeenMap,
  setAdminLastSeen,
  computeHasUnread,
  computeConversationUnread,
  messagesEqual,
  mergeMessagesForConversation,
  resolveRefreshedMessagesForConversation,
  conversationsEqual,
  selectedConversationWasRemoved,
  pageMayHaveOlderMessages,
  hasOlderMessagesForConversation,
} from '../utils/judgeChatUtils';

export type JudgeChatMode = 'judge' | 'admin';

interface JudgeChatContextType {
  mode: JudgeChatMode;
  eventId: number;
  isDrawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  judgeName: string | null;
  setJudgeName: (name: string) => void;
  needsNamePrompt: boolean;
  messages: JudgeChatMessage[];
  conversations: JudgeChatConversation[];
  selectedConversationKey: string | null;
  setSelectedConversationKey: (key: string | null) => void;
  isLoading: boolean;
  isSending: boolean;
  error: string | null;
  hasUnread: boolean;
  hasOlderMessages: boolean;
  isLoadingOlder: boolean;
  conversationUnread: (
    conversationKey: string,
    lastMessageId: number,
  ) => boolean;
  sendMessage: (message: string) => Promise<boolean>;
  loadOlderMessages: () => Promise<number | null>;
  deleteConversation: (conversationKey: string) => Promise<boolean>;
  markSeen: () => void;
  markConversationSeen: (conversationKey: string) => void;
  refreshConversations: () => Promise<void>;
}

const JudgeChatContext = createContext<JudgeChatContextType | undefined>(
  undefined,
);

const JUDGE_CHAT_MESSAGE_PAGE_SIZE = 100;
const JUDGE_CHAT_JUDGE_PAGINATION_KEY = '__judge__';

interface JudgeChatProviderProps {
  children: ReactNode;
  eventId: number;
  mode: JudgeChatMode;
}

export function JudgeChatProvider({
  children,
  eventId,
  mode,
}: JudgeChatProviderProps) {
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const [judgeName, setJudgeNameState] = useState<string | null>(() =>
    mode === 'judge' ? getJudgeDisplayName() : null,
  );
  const [messages, setMessages] = useState<JudgeChatMessage[]>([]);
  const [conversations, setConversations] = useState<JudgeChatConversation[]>(
    [],
  );
  const [selectedConversationKey, setSelectedConversationKey] = useState<
    string | null
  >(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasUnread, setHasUnread] = useState(false);
  const [olderMessagesByConversation, setOlderMessagesByConversation] =
    useState<Record<string, boolean>>({});
  const [adminSeenMap, setAdminSeenMap] = useState<Record<string, number>>(() =>
    getAdminSeenMap(),
  );
  const [isDocumentVisible, setIsDocumentVisible] = useState(() =>
    typeof document === 'undefined'
      ? true
      : document.visibilityState === 'visible',
  );

  const lastSeenRef = useRef(mode === 'judge' ? getJudgeLastSeen(eventId) : 0);
  const isDrawerOpenRef = useRef(isDrawerOpen);
  const selectedKeyRef = useRef(selectedConversationKey);
  const messagesRef = useRef(messages);
  const conversationsRef = useRef(conversations);
  const fetchGenerationRef = useRef(0);

  const needsNamePrompt = mode === 'judge' && !judgeName;

  const getPaginationKey = useCallback(
    (conversationKey?: string | null) => {
      if (mode === 'judge') return JUDGE_CHAT_JUDGE_PAGINATION_KEY;
      return conversationKey ?? null;
    },
    [mode],
  );

  const setHasOlderMessages = useCallback(
    (conversationKey: string | null | undefined, hasOlder: boolean) => {
      const key = getPaginationKey(conversationKey);
      if (!key) return;
      setOlderMessagesByConversation((prev) => {
        if (prev[key] === hasOlder) return prev;
        return { ...prev, [key]: hasOlder };
      });
    },
    [getPaginationKey],
  );

  const setJudgeName = useCallback((name: string) => {
    setJudgeDisplayName(name);
    setJudgeNameState(name);
  }, []);

  useEffect(() => {
    isDrawerOpenRef.current = isDrawerOpen;
  }, [isDrawerOpen]);

  useEffect(() => {
    selectedKeyRef.current = selectedConversationKey;
  }, [selectedConversationKey]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const updateUnreadFromMessages = useCallback(
    (msgs: JudgeChatMessage[], forceSeen = false) => {
      if (msgs.length === 0) {
        setHasUnread(false);
        return;
      }
      const latestId = Math.max(...msgs.map((m) => m.id));
      const isActive =
        mode === 'judge'
          ? isDrawerOpenRef.current
          : selectedKeyRef.current != null;

      if (forceSeen || isActive) {
        if (mode === 'judge') {
          lastSeenRef.current = latestId;
          setJudgeLastSeen(eventId, latestId);
        }
        setHasUnread(false);
      } else {
        setHasUnread(computeHasUnread(msgs, lastSeenRef.current));
      }
    },
    [mode, eventId],
  );

  const fetchConversations = useCallback(
    async (silent = false) => {
      try {
        const response = await fetch(`/chat/events/${eventId}/conversations`, {
          credentials: 'include',
        });
        if (response.ok) {
          const data = (await response.json()) as JudgeChatConversation[];
          if (
            mode === 'admin' &&
            selectedConversationWasRemoved(data, selectedKeyRef.current)
          ) {
            const removedKey = selectedKeyRef.current;
            fetchGenerationRef.current += 1;
            selectedKeyRef.current = null;
            messagesRef.current = [];
            setSelectedConversationKey(null);
            setMessages([]);
            setHasOlderMessages(removedKey, false);
          }
          if (!conversationsEqual(data, conversationsRef.current)) {
            setConversations(data);
            if (!silent) {
              setAdminSeenMap(getAdminSeenMap());
            }
          }
        }
      } catch (err) {
        console.error('Failed to load conversations:', err);
      }
    },
    [eventId, mode, setHasOlderMessages],
  );

  const fetchMessages = useCallback(
    async (options?: {
      conversationKey?: string;
      before?: number;
      silent?: boolean;
    }) => {
      const silent = options?.silent ?? false;
      if (!silent) setIsLoading(true);

      try {
        let url = `/chat/events/${eventId}/messages`;
        const params = new URLSearchParams();
        if (mode === 'admin') {
          const key = options?.conversationKey ?? selectedKeyRef.current;
          if (!key) return null;
          params.set('conversationKey', key);
        }
        if (options?.before) {
          params.set('before', String(options.before));
        }
        const qs = params.toString();
        if (qs) url += `?${qs}`;

        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(
            (data as { error?: string }).error || 'Failed to load messages',
          );
        }

        const data = (await response.json()) as JudgeChatMessage[];
        return data;
      } catch (err) {
        if (!silent) {
          setError(
            err instanceof Error ? err.message : 'Failed to load messages',
          );
        }
        return null;
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [eventId, mode],
  );

  const loadMessages = useCallback(
    async (silent = false) => {
      if (mode === 'admin' && !selectedKeyRef.current) return;

      const generation = ++fetchGenerationRef.current;
      const requestKey = mode === 'admin' ? selectedKeyRef.current : null;

      const data = await fetchMessages({
        silent,
        conversationKey: requestKey ?? undefined,
      });

      if (data == null) return;
      if (generation !== fetchGenerationRef.current) return;
      if (mode === 'admin' && selectedKeyRef.current !== requestKey) return;

      setHasOlderMessages(
        requestKey,
        pageMayHaveOlderMessages(data.length, JUDGE_CHAT_MESSAGE_PAGE_SIZE),
      );

      const nextMessages = silent
        ? resolveRefreshedMessagesForConversation(
            data,
            messagesRef.current,
            mode === 'admin' ? requestKey : null,
          )
        : data;

      if (messagesEqual(nextMessages, messagesRef.current)) {
        return;
      }
      setMessages(nextMessages);
      updateUnreadFromMessages(nextMessages);
      if (!silent) {
        setError(null);
      }
    },
    [mode, fetchMessages, updateUnreadFromMessages, setHasOlderMessages],
  );

  const loadOlderMessages = useCallback(async (): Promise<number | null> => {
    if (messagesRef.current.length === 0) return null;
    const oldestId = messagesRef.current[0].id;

    const generation = fetchGenerationRef.current;
    const requestKey = mode === 'admin' ? selectedKeyRef.current : null;

    setIsLoadingOlder(true);
    try {
      const older = await fetchMessages({
        before: oldestId,
        conversationKey: requestKey ?? undefined,
        silent: true,
      });

      if (generation !== fetchGenerationRef.current) return null;
      if (mode === 'admin' && selectedKeyRef.current !== requestKey) {
        return null;
      }

      if (older == null) return null;

      setHasOlderMessages(
        requestKey,
        pageMayHaveOlderMessages(older.length, JUDGE_CHAT_MESSAGE_PAGE_SIZE),
      );

      if (older.length > 0) {
        const anchorId = messagesRef.current[0].id;
        setMessages((prev) =>
          mergeMessagesForConversation(
            older,
            prev,
            mode === 'admin' ? requestKey : null,
          ),
        );
        return anchorId;
      }
      return null;
    } finally {
      setIsLoadingOlder(false);
    }
  }, [mode, fetchMessages, setHasOlderMessages]);

  const sendMessage = useCallback(
    async (message: string): Promise<boolean> => {
      setIsSending(true);
      setError(null);
      try {
        const body: Record<string, string> = { message };
        if (mode === 'admin') {
          if (!selectedKeyRef.current) {
            setError('No conversation selected');
            return false;
          }
          body.conversationKey = selectedKeyRef.current;
        } else if (judgeName) {
          body.senderName = judgeName;
        }

        const response = await fetch(`/chat/events/${eventId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(
            (data as { error?: string }).error || 'Failed to send message',
          );
        }

        const newMessage = (await response.json()) as JudgeChatMessage;
        setMessages((prev) => [...prev, newMessage]);
        updateUnreadFromMessages([...messagesRef.current, newMessage], true);

        if (mode === 'admin') {
          await fetchConversations();
        }
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to send message');
        return false;
      } finally {
        setIsSending(false);
      }
    },
    [mode, eventId, judgeName, updateUnreadFromMessages, fetchConversations],
  );

  const deleteConversation = useCallback(
    async (conversationKey: string): Promise<boolean> => {
      try {
        const response = await fetch(
          `/chat/events/${eventId}/conversations/${encodeURIComponent(conversationKey)}`,
          { method: 'DELETE', credentials: 'include' },
        );
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(
            (data as { error?: string }).error ||
              'Failed to delete conversation',
          );
        }
        setConversations((prev) =>
          prev.filter((c) => c.conversationKey !== conversationKey),
        );
        if (selectedKeyRef.current === conversationKey) {
          setSelectedConversationKey(null);
          setMessages([]);
          setHasOlderMessages(conversationKey, false);
        }
        return true;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to delete conversation',
        );
        return false;
      }
    },
    [eventId],
  );

  const markSeen = useCallback(() => {
    if (messagesRef.current.length === 0) return;
    const latestId = Math.max(...messagesRef.current.map((m) => m.id));
    lastSeenRef.current = latestId;
    if (mode === 'judge') {
      setJudgeLastSeen(eventId, latestId);
    }
    setHasUnread(false);
  }, [mode, eventId]);

  const markConversationSeen = useCallback((conversationKey: string) => {
    const conv = conversationsRef.current.find(
      (c) => c.conversationKey === conversationKey,
    );
    const lastId =
      conv?.lastMessageId ??
      (messagesRef.current.length > 0
        ? Math.max(...messagesRef.current.map((m) => m.id))
        : 0);
    if (lastId <= 0) return;

    const currentSeen = getAdminSeenMap()[conversationKey] ?? 0;
    if (lastId <= currentSeen) return;

    setAdminLastSeen(conversationKey, lastId);
    setAdminSeenMap(getAdminSeenMap());
  }, []);

  const conversationUnread = useCallback(
    (conversationKey: string, lastMessageId: number) =>
      computeConversationUnread(lastMessageId, conversationKey, adminSeenMap),
    [adminSeenMap],
  );

  // Initial load for admin conversations
  useEffect(() => {
    if (mode === 'admin') {
      fetchConversations();
    }
  }, [mode, fetchConversations]);

  // Load messages when admin selects a conversation
  useEffect(() => {
    if (mode !== 'admin') return;

    fetchGenerationRef.current += 1;
    messagesRef.current = [];
    setMessages([]);

    if (selectedConversationKey) {
      loadMessages(false);
      markConversationSeen(selectedConversationKey);
    }
  }, [mode, selectedConversationKey, loadMessages, markConversationSeen]);

  // Initial load for judge
  useEffect(() => {
    if (mode === 'judge') {
      loadMessages(false);
    }
  }, [mode, loadMessages]);

  // Mark seen when drawer opens (judge) or thread is active (admin)
  useEffect(() => {
    if (mode === 'judge' && isDrawerOpen && messages.length > 0) {
      markSeen();
    }
  }, [mode, isDrawerOpen, messages, markSeen]);

  useEffect(() => {
    if (mode === 'admin' && selectedConversationKey && messages.length > 0) {
      const latestId = Math.max(...messages.map((m) => m.id));
      const currentSeen = getAdminSeenMap()[selectedConversationKey] ?? 0;
      if (latestId > currentSeen) {
        markConversationSeen(selectedConversationKey);
      }
    }
  }, [mode, selectedConversationKey, messages, markConversationSeen]);

  // Polling
  useEffect(() => {
    if (!isDocumentVisible) return;

    let pollMs: number;
    if (mode === 'judge') {
      pollMs = isDrawerOpen ? 3000 : 15000;
    } else {
      pollMs = selectedConversationKey ? 3000 : 15000;
    }

    const poll = () => {
      if (mode === 'judge') {
        loadMessages(true);
      } else {
        fetchConversations(true);
        if (selectedKeyRef.current) {
          loadMessages(true);
        }
      }
    };

    poll();
    const interval = setInterval(poll, pollMs);
    return () => clearInterval(interval);
  }, [
    mode,
    isDrawerOpen,
    selectedConversationKey,
    isDocumentVisible,
    loadMessages,
    fetchConversations,
  ]);

  const activePaginationKey =
    mode === 'admin'
      ? selectedConversationKey
      : JUDGE_CHAT_JUDGE_PAGINATION_KEY;
  const hasOlderMessages =
    messages.length > 0 &&
    hasOlderMessagesForConversation(
      olderMessagesByConversation,
      activePaginationKey,
    );

  return (
    <JudgeChatContext.Provider
      value={{
        mode,
        eventId,
        isDrawerOpen,
        setDrawerOpen,
        judgeName,
        setJudgeName,
        needsNamePrompt,
        messages,
        conversations,
        selectedConversationKey,
        setSelectedConversationKey,
        isLoading,
        isSending,
        error,
        hasUnread,
        hasOlderMessages,
        isLoadingOlder,
        conversationUnread,
        sendMessage,
        loadOlderMessages,
        deleteConversation,
        markSeen,
        markConversationSeen,
        refreshConversations: fetchConversations,
      }}
    >
      {children}
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
