import React, { useRef, useEffect } from 'react';
import {
  JudgeChatMessage,
  groupMessagesByDate,
  formatChatTime,
} from '../../utils/judgeChatUtils';
import './JudgeChat.css';

interface JudgeChatMessageListProps {
  messages: JudgeChatMessage[];
  isLoading: boolean;
  ownSenderName?: string | null;
  emptyMessage?: string;
  hasOlderMessages?: boolean;
  isLoadingOlder?: boolean;
  onLoadOlder?: () => void;
  autoScroll?: boolean;
}

export default function JudgeChatMessageList({
  messages,
  isLoading,
  ownSenderName,
  emptyMessage = 'No messages yet. Send a question to event staff.',
  hasOlderMessages = false,
  isLoadingOlder = false,
  onLoadOlder,
  autoScroll = true,
}: JudgeChatMessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef<number>(0);
  const loadingOlderRef = useRef(false);
  const lastScrolledMessageIdRef = useRef(0);

  useEffect(() => {
    if (autoScroll && messagesEndRef.current && !loadingOlderRef.current) {
      const latestId =
        messages.length > 0 ? messages[messages.length - 1].id : 0;
      if (latestId > lastScrolledMessageIdRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        lastScrolledMessageIdRef.current = latestId;
      }
    }
    loadingOlderRef.current = false;
  }, [messages, autoScroll]);

  useEffect(() => {
    if (messages.length === 0) {
      lastScrolledMessageIdRef.current = 0;
    }
  }, [messages.length]);

  const handleLoadOlder = async () => {
    if (!onLoadOlder || !containerRef.current) return;
    loadingOlderRef.current = true;
    prevScrollHeightRef.current = containerRef.current.scrollHeight;
    await onLoadOlder();
    requestAnimationFrame(() => {
      if (containerRef.current) {
        const newScrollHeight = containerRef.current.scrollHeight;
        containerRef.current.scrollTop +=
          newScrollHeight - prevScrollHeightRef.current;
      }
    });
  };

  const groupedMessages = groupMessagesByDate(messages);

  const isOwnMessage = (msg: JudgeChatMessage) => {
    if (ownSenderName) {
      return msg.sender_role === 'judge' && msg.sender_name === ownSenderName;
    }
    return msg.sender_role === 'judge';
  };

  return (
    <div className="chat-messages" ref={containerRef}>
      {hasOlderMessages && onLoadOlder && (
        <button
          type="button"
          className="judge-chat-load-older"
          onClick={handleLoadOlder}
          disabled={isLoadingOlder}
        >
          {isLoadingOlder ? 'Loading…' : 'Load older messages'}
        </button>
      )}

      {isLoading && messages.length === 0 ? (
        <div className="chat-loading">Loading messages…</div>
      ) : messages.length === 0 ? (
        <div className="chat-empty">
          <p>{emptyMessage}</p>
        </div>
      ) : (
        Object.entries(groupedMessages).map(([date, msgs]) => (
          <div key={date} className="chat-date-group">
            <div className="chat-date-divider">
              <span>{date}</span>
            </div>
            {msgs.map((msg) => (
              <div
                key={msg.id}
                className={`chat-message ${isOwnMessage(msg) ? 'own' : ''} ${msg.sender_role === 'admin' ? 'admin' : ''}`}
              >
                <div className="chat-message-header">
                  <span className="chat-sender">
                    {msg.sender_name}
                    {msg.sender_role === 'admin' && (
                      <span className="admin-badge">Admin</span>
                    )}
                  </span>
                  <span className="chat-time">
                    {formatChatTime(msg.created_at)}
                  </span>
                </div>
                <div className="chat-message-body">{msg.message}</div>
              </div>
            ))}
          </div>
        ))
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}
