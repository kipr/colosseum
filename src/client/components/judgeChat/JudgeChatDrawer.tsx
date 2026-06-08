import React, { useEffect, useRef, useState } from 'react';
import { useJudgeChat } from '../../contexts/JudgeChatContext';
import JudgeChatMessageList from './JudgeChatMessageList';
import JudgeChatInput from './JudgeChatInput';
import JudgeChatNamePrompt from './JudgeChatNamePrompt';
import './JudgeChat.css';

interface JudgeChatDrawerProps {
  eventName?: string;
}

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= breakpoint : false,
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= breakpoint);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);

  return isMobile;
}

export default function JudgeChatDrawer({ eventName }: JudgeChatDrawerProps) {
  const {
    isDrawerOpen,
    setDrawerOpen,
    judgeName,
    setJudgeName,
    needsNamePrompt,
    messages,
    isLoading,
    isSending,
    error,
    sendMessage,
    hasOlderMessages,
    isLoadingOlder,
    loadOlderMessages,
    markSeen,
  } = useJudgeChat();

  const [view, setView] = useState<'chat' | 'settings'>('chat');
  const triggerRef = useRef<HTMLElement | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isDrawerOpen) {
      triggerRef.current = document.activeElement as HTMLElement;
      markSeen();
      if (isMobile) {
        document.body.style.overflow = 'hidden';
      }
    } else {
      if (isMobile) {
        document.body.style.overflow = '';
      }
      if (triggerRef.current) {
        triggerRef.current.focus();
      }
      setView('chat');
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isDrawerOpen, isMobile, markSeen]);

  useEffect(() => {
    if (!isDrawerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawerOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isDrawerOpen, setDrawerOpen]);

  useEffect(() => {
    if (isDrawerOpen && drawerRef.current) {
      const closeBtn = drawerRef.current.querySelector(
        '.judge-chat-close-btn',
      ) as HTMLElement | null;
      closeBtn?.focus();
    }
  }, [isDrawerOpen]);

  if (!isDrawerOpen) return null;

  const subtitle = eventName || 'Messages go to tournament administrators';

  const showNamePrompt = needsNamePrompt && view === 'chat';

  return (
    <>
      <div
        className="judge-chat-backdrop"
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <div
        ref={drawerRef}
        className={`judge-chat-drawer ${isMobile ? 'judge-chat-drawer--mobile' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="judge-chat-drawer-title"
      >
        <div className="judge-chat-header">
          <div className="judge-chat-header-text">
            <h2 id="judge-chat-drawer-title">Event Staff</h2>
            <p>{subtitle}</p>
          </div>
          <div className="judge-chat-header-actions">
            {!needsNamePrompt && view === 'chat' && (
              <button
                type="button"
                className="judge-chat-settings-btn"
                onClick={() => setView('settings')}
                aria-label="Change display name"
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
                </svg>
              </button>
            )}
            <button
              type="button"
              className="judge-chat-close-btn"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>
        </div>

        <div className="judge-chat-body">
          {showNamePrompt ? (
            <JudgeChatNamePrompt
              onSubmit={(name) => {
                setJudgeName(name);
              }}
            />
          ) : view === 'settings' ? (
            <JudgeChatNamePrompt
              variant="settings"
              initialName={judgeName || ''}
              onSubmit={(name) => {
                setJudgeName(name);
                setView('chat');
              }}
              onCancel={() => setView('chat')}
            />
          ) : (
            <>
              <JudgeChatMessageList
                messages={messages}
                isLoading={isLoading}
                ownSenderName={judgeName}
                hasOlderMessages={hasOlderMessages}
                isLoadingOlder={isLoadingOlder}
                onLoadOlder={loadOlderMessages}
              />
              <JudgeChatInput
                onSend={sendMessage}
                isSending={isSending}
                error={error}
                disabled={needsNamePrompt}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}
