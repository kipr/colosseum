import React from 'react';
import { useJudgeChat } from '../../contexts/JudgeChatContext';
import './JudgeChat.css';

export default function JudgeChatButton() {
  const { isDrawerOpen, setDrawerOpen, hasUnread } = useJudgeChat();

  const handleClick = () => {
    setDrawerOpen(!isDrawerOpen);
  };

  const ariaLabel =
    hasUnread && !isDrawerOpen
      ? 'Contact event staff (unread messages)'
      : 'Contact event staff';

  return (
    <button
      type="button"
      className="btn btn-secondary judge-chat-staff-btn"
      onClick={handleClick}
      aria-label={ariaLabel}
      aria-expanded={isDrawerOpen}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
      </svg>
      <span className="judge-chat-staff-label">Event Staff</span>
      {hasUnread && !isDrawerOpen && (
        <span className="judge-chat-unread-dot" aria-hidden="true" />
      )}
    </button>
  );
}
