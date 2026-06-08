import React, { useState } from 'react';
import './JudgeChat.css';

interface JudgeChatInputProps {
  onSend: (message: string) => Promise<boolean>;
  isSending: boolean;
  error?: string | null;
  placeholder?: string;
  disabled?: boolean;
}

export default function JudgeChatInput({
  onSend,
  isSending,
  error,
  placeholder = 'Type a message…',
  disabled = false,
}: JudgeChatInputProps) {
  const [inputMessage, setInputMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputMessage.trim();
    if (!trimmed || isSending || disabled) return;

    const success = await onSend(trimmed);
    if (success) {
      setInputMessage('');
    }
  };

  return (
    <>
      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          placeholder={placeholder}
          maxLength={1000}
          disabled={disabled || isSending}
        />
        <button
          type="submit"
          disabled={!inputMessage.trim() || isSending || disabled}
          aria-label="Send message"
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </form>
      {error && <div className="judge-chat-input-error">{error}</div>}
    </>
  );
}
