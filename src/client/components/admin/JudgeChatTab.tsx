import React, { useState, useEffect } from 'react';
import { useEvent } from '../../contexts/EventContext';
import {
  JudgeChatProvider,
  useJudgeChat,
} from '../../contexts/JudgeChatContext';
import JudgeChatMessageList from '../judgeChat/JudgeChatMessageList';
import JudgeChatInput from '../judgeChat/JudgeChatInput';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import {
  formatRelativeActivity,
  truncatePreview,
} from '../../utils/judgeChatUtils';
import '../judgeChat/JudgeChat.css';

function useIsNarrow(breakpoint = 900) {
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= breakpoint : false,
  );

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth <= breakpoint);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);

  return isNarrow;
}

function JudgeChatInbox() {
  const {
    conversations,
    selectedConversationKey,
    setSelectedConversationKey,
    messages,
    isLoading,
    isSending,
    error,
    sendMessage,
    deleteConversation,
    conversationUnread,
    hasOlderMessages,
    isLoadingOlder,
    loadOlderMessages,
    markConversationSeen,
  } = useJudgeChat();

  const { confirm, ConfirmDialog } = useConfirm();
  const toast = useToast();
  const isNarrow = useIsNarrow();
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list');

  const selectedConversation = conversations.find(
    (c) => c.conversationKey === selectedConversationKey,
  );

  const handleSelectConversation = (key: string) => {
    setSelectedConversationKey(key);
    markConversationSeen(key);
    if (isNarrow) {
      setMobileView('thread');
    }
  };

  const handleDelete = async () => {
    if (!selectedConversationKey) return;
    const confirmed = await confirm({
      title: 'Delete conversation',
      message:
        'Delete all messages in this judge conversation? This cannot be undone.',
      confirmText: 'Delete',
      confirmStyle: 'danger',
    });
    if (!confirmed) return;

    const success = await deleteConversation(selectedConversationKey);
    if (success) {
      toast.success('Conversation deleted');
      if (isNarrow) setMobileView('list');
    } else {
      toast.error('Failed to delete conversation');
    }
  };

  const templateId = messages.find((m) => m.template_id != null)?.template_id;

  const inboxClass = isNarrow
    ? `judge-chat-inbox judge-chat-inbox--${mobileView === 'list' ? 'list' : 'thread'}-view`
    : 'judge-chat-inbox';

  return (
    <>
      <div className={inboxClass}>
        <div className="judge-chat-conversation-list" role="list">
          {isNarrow && mobileView === 'thread' && (
            <button
              type="button"
              className="judge-chat-back-btn"
              onClick={() => setMobileView('list')}
              style={{ padding: '0.75rem 1rem' }}
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
              </svg>
              Conversations
            </button>
          )}

          {conversations.length === 0 ? (
            <div className="judge-chat-empty-inbox">
              <p>No judge messages yet for this event.</p>
            </div>
          ) : (
            conversations.map((conv) => {
              const unread = conversationUnread(
                conv.conversationKey,
                conv.lastMessageId,
              );
              const isActive = conv.conversationKey === selectedConversationKey;
              return (
                <button
                  key={conv.conversationKey}
                  type="button"
                  role="listitem"
                  className={`judge-chat-conversation-item ${isActive ? 'active' : ''}`}
                  onClick={() => handleSelectConversation(conv.conversationKey)}
                >
                  <div className="judge-chat-conversation-row">
                    <span className="judge-chat-conversation-name">
                      {conv.lastJudgeName || 'Judge'}
                    </span>
                    <span className="judge-chat-conversation-time">
                      {formatRelativeActivity(conv.lastActivity)}
                    </span>
                  </div>
                  <span className="judge-chat-conversation-preview">
                    {truncatePreview(conv.lastMessage)}
                  </span>
                  <span className="judge-chat-conversation-meta">
                    {conv.messageCount}{' '}
                    {conv.messageCount === 1 ? 'message' : 'messages'}
                  </span>
                  {unread && !isActive && (
                    <span
                      className="judge-chat-conversation-unread"
                      aria-label="Unread"
                    />
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="judge-chat-thread">
          {!selectedConversationKey ? (
            <div className="judge-chat-empty-inbox">
              <p>Select a conversation to view messages.</p>
            </div>
          ) : (
            <>
              <div className="judge-chat-thread-header">
                <div className="judge-chat-thread-header-info">
                  <h3>{selectedConversation?.lastJudgeName || 'Judge'}</h3>
                  {templateId != null && <p>Scoresheet #{templateId}</p>}
                </div>
                <button
                  type="button"
                  className="judge-chat-delete-btn"
                  onClick={handleDelete}
                  aria-label="Delete conversation"
                  title="Delete conversation"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                  </svg>
                </button>
              </div>
              <JudgeChatMessageList
                key={selectedConversationKey}
                messages={messages}
                isLoading={isLoading}
                emptyMessage="No messages in this conversation."
                hasOlderMessages={hasOlderMessages}
                isLoadingOlder={isLoadingOlder}
                onLoadOlder={loadOlderMessages}
              />
              <JudgeChatInput
                onSend={sendMessage}
                isSending={isSending}
                error={error}
                placeholder="Reply to judge…"
              />
            </>
          )}
        </div>
      </div>
      {ConfirmDialog}
      {toast.ToastContainer}
    </>
  );
}

export default function JudgeChatTab() {
  const { selectedEvent } = useEvent();
  const selectedEventId = selectedEvent?.id ?? null;

  if (!selectedEventId) {
    return (
      <div className="card">
        <p style={{ color: 'var(--secondary-color)' }}>
          Select an event to view judge chat.
        </p>
      </div>
    );
  }

  return (
    <JudgeChatProvider
      key={selectedEventId}
      eventId={selectedEventId}
      mode="admin"
    >
      <JudgeChatInbox />
    </JudgeChatProvider>
  );
}
