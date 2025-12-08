import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';

interface ChatMessage {
  id: number;
  spreadsheet_id: string;
  sender_name: string;
  message: string;
  is_admin: boolean;
  created_at: string;
}

interface Spreadsheet {
  spreadsheet_id: string;
  spreadsheet_name: string;
}

interface ChatContextType {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  chatName: string | null;
  setChatName: (name: string) => void;
  needsNamePrompt: boolean;
  spreadsheets: Spreadsheet[];
  selectedSpreadsheet: Spreadsheet | null;
  setSelectedSpreadsheet: (spreadsheet: Spreadsheet | null) => void;
  messages: ChatMessage[];
  sendMessage: (message: string) => Promise<void>;
  loadMessages: () => Promise<void>;
  clearChat: () => Promise<void>;
  isLoading: boolean;
  view: 'list' | 'chat' | 'settings';
  setView: (view: 'list' | 'chat' | 'settings') => void;
  isAdmin: boolean;
  hasUnreadMessages: boolean;
  clearUnread: () => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

const CHAT_NAME_KEY = 'colosseum_chat_name';
const LAST_CHAT_KEY = 'colosseum_last_chat';
const LAST_SEEN_MESSAGE_KEY = 'colosseum_last_seen_message';
const ADMIN_CHAT_ROOM_ID = '__ADMIN_ONLY__';

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  
  const [isOpen, setIsOpen] = useState(false);
  const [chatName, setChatNameState] = useState<string | null>(() => {
    // Initialize from localStorage for non-admin users
    if (typeof window !== 'undefined') {
      return localStorage.getItem(CHAT_NAME_KEY);
    }
    return null;
  });
  const [spreadsheets, setSpreadsheets] = useState<Spreadsheet[]>([]);
  const [selectedSpreadsheet, setSelectedSpreadsheetState] = useState<Spreadsheet | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [view, setViewState] = useState<'list' | 'chat' | 'settings'>('list');
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [lastSeenMessageId, setLastSeenMessageId] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(LAST_SEEN_MESSAGE_KEY);
      return stored ? parseInt(stored, 10) : 0;
    }
    return 0;
  });
  
  // Track if we've restored from localStorage
  const hasRestoredRef = useRef(false);

  // Determine if user is admin
  const isAdmin = user?.isAdmin || false;

  // Determine effective chat name (admin uses their user name)
  const effectiveChatName = isAdmin ? user?.name || 'Admin' : chatName;

  // Check if name prompt is needed
  const needsNamePrompt = !isAdmin && !chatName;

  // Set chat name and persist for non-admins
  const setChatName = useCallback((name: string) => {
    setChatNameState(name);
    if (!isAdmin) {
      localStorage.setItem(CHAT_NAME_KEY, name);
    }
  }, [isAdmin]);

  // Wrapper for setSelectedSpreadsheet that also persists to localStorage
  const setSelectedSpreadsheet = useCallback((spreadsheet: Spreadsheet | null) => {
    setSelectedSpreadsheetState(spreadsheet);
    if (spreadsheet) {
      localStorage.setItem(LAST_CHAT_KEY, JSON.stringify(spreadsheet));
    }
  }, []);

  // Wrapper for setView that handles persistence
  const setView = useCallback((newView: 'list' | 'chat' | 'settings') => {
    setViewState(newView);
    // If going back to list, clear the last chat memory
    if (newView === 'list') {
      localStorage.removeItem(LAST_CHAT_KEY);
      setSelectedSpreadsheetState(null);
    }
  }, []);

  // Clear unread messages when chat is opened and we're viewing that chat
  const clearUnread = useCallback(() => {
    if (messages.length > 0) {
      const latestId = Math.max(...messages.map(m => m.id));
      setLastSeenMessageId(latestId);
      localStorage.setItem(LAST_SEEN_MESSAGE_KEY, String(latestId));
    }
    setHasUnreadMessages(false);
  }, [messages]);

  // Load available spreadsheets
  useEffect(() => {
    const loadSpreadsheets = async () => {
      try {
        const response = await fetch('/chat/spreadsheets');
        if (response.ok) {
          let data = await response.json();
          
          // Add admin-only chat room at the top for admin users
          if (isAdmin) {
            const adminRoom: Spreadsheet = {
              spreadsheet_id: ADMIN_CHAT_ROOM_ID,
              spreadsheet_name: '🔒 Admin Only'
            };
            data = [adminRoom, ...data];
          }
          
          setSpreadsheets(data);
          
          // Restore last chat if not already restored
          if (!hasRestoredRef.current) {
            hasRestoredRef.current = true;
            const lastChatStr = localStorage.getItem(LAST_CHAT_KEY);
            if (lastChatStr) {
              try {
                const lastChat = JSON.parse(lastChatStr) as Spreadsheet;
                // Verify this spreadsheet still exists in the list (or is admin chat for admins)
                const exists = data.some((s: Spreadsheet) => s.spreadsheet_id === lastChat.spreadsheet_id);
                if (exists) {
                  setSelectedSpreadsheetState(lastChat);
                  setViewState('chat');
                }
              } catch (e) {
                console.error('Failed to parse last chat:', e);
              }
            }
          }
        }
      } catch (error) {
        console.error('Failed to load spreadsheets:', error);
      }
    };

    // Load spreadsheets on mount, not just when open
    loadSpreadsheets();
  }, [isAdmin]);

  // Refs to avoid recreating loadMessages on every state change
  const lastSeenMessageIdRef = useRef(lastSeenMessageId);
  const isOpenRef = useRef(isOpen);
  
  // Keep refs in sync
  useEffect(() => {
    lastSeenMessageIdRef.current = lastSeenMessageId;
  }, [lastSeenMessageId]);
  
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  // Load messages for selected spreadsheet
  const loadMessages = useCallback(async (checkUnread = false) => {
    if (!selectedSpreadsheet) return;

    if (!checkUnread) {
      setIsLoading(true);
    }
    try {
      // Use different endpoint for admin chat
      const isAdminChat = selectedSpreadsheet.spreadsheet_id === ADMIN_CHAT_ROOM_ID;
      const url = isAdminChat 
        ? '/chat/admin/messages'
        : `/chat/messages/${selectedSpreadsheet.spreadsheet_id}`;
      
      const response = await fetch(url, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json() as ChatMessage[];
        setMessages(data);
        
        // Check for unread messages (new messages since last seen)
        if (data.length > 0) {
          const latestId = Math.max(...data.map(m => m.id));
          if (latestId > lastSeenMessageIdRef.current) {
            // Only show unread indicator if chat is closed
            if (!isOpenRef.current) {
              setHasUnreadMessages(true);
            } else {
              // If chat is open, update the last seen
              setLastSeenMessageId(latestId);
              localStorage.setItem(LAST_SEEN_MESSAGE_KEY, String(latestId));
              lastSeenMessageIdRef.current = latestId;
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
    } finally {
      if (!checkUnread) {
        setIsLoading(false);
      }
    }
  }, [selectedSpreadsheet]);

  // Auto-load messages when spreadsheet is selected (poll always if a chat is remembered)
  useEffect(() => {
    if (selectedSpreadsheet) {
      loadMessages();
      // Set up polling for new messages every 3 seconds (even when closed, to detect new messages)
      const interval = setInterval(() => loadMessages(true), 3000);
      return () => clearInterval(interval);
    }
  }, [selectedSpreadsheet, loadMessages]);

  // Clear unread when opening chat
  useEffect(() => {
    if (isOpen && selectedSpreadsheet && view === 'chat' && messages.length > 0) {
      const latestId = Math.max(...messages.map(m => m.id));
      setLastSeenMessageId(latestId);
      localStorage.setItem(LAST_SEEN_MESSAGE_KEY, String(latestId));
      setHasUnreadMessages(false);
    }
  }, [isOpen, selectedSpreadsheet, view, messages]);

  // Send a message
  const sendMessage = useCallback(async (message: string) => {
    if (!selectedSpreadsheet || !effectiveChatName) return;

    try {
      const isAdminChat = selectedSpreadsheet.spreadsheet_id === ADMIN_CHAT_ROOM_ID;
      
      // Use different endpoint and body for admin chat
      const url = isAdminChat ? '/chat/admin/messages' : '/chat/messages';
      const body = isAdminChat
        ? { message }
        : {
            spreadsheetId: selectedSpreadsheet.spreadsheet_id,
            senderName: effectiveChatName,
            message,
          };
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const newMessage = await response.json();
        setMessages(prev => [...prev, newMessage]);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }, [selectedSpreadsheet, effectiveChatName]);

  // Clear all messages in the current chat (admin only)
  const clearChat = useCallback(async () => {
    if (!selectedSpreadsheet || !isAdmin) return;

    try {
      const isAdminChat = selectedSpreadsheet.spreadsheet_id === ADMIN_CHAT_ROOM_ID;
      const url = isAdminChat 
        ? '/chat/admin/messages'
        : `/chat/messages/${selectedSpreadsheet.spreadsheet_id}`;
      
      const response = await fetch(url, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        setMessages([]);
        // Reset last seen since all messages are cleared
        setLastSeenMessageId(0);
        localStorage.setItem(LAST_SEEN_MESSAGE_KEY, '0');
      }
    } catch (error) {
      console.error('Failed to clear chat:', error);
    }
  }, [selectedSpreadsheet, isAdmin]);

  // Note: We no longer reset view when closing - the chat remembers the last room

  return (
    <ChatContext.Provider
      value={{
        isOpen,
        setIsOpen,
        chatName: effectiveChatName,
        setChatName,
        needsNamePrompt,
        spreadsheets,
        selectedSpreadsheet,
        setSelectedSpreadsheet,
        messages,
        sendMessage,
        loadMessages: () => loadMessages(false),
        clearChat,
        isLoading,
        view,
        setView,
        isAdmin,
        hasUnreadMessages,
        clearUnread,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within ChatProvider');
  }
  return context;
}

