import React, { useState } from 'react';
import './JudgeChat.css';

interface JudgeChatNamePromptProps {
  onSubmit: (name: string) => void;
  initialName?: string;
  variant?: 'prompt' | 'settings';
  onCancel?: () => void;
}

export default function JudgeChatNamePrompt({
  onSubmit,
  initialName = '',
  variant = 'prompt',
  onCancel,
}: JudgeChatNamePromptProps) {
  const [nameInput, setNameInput] = useState(initialName);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (trimmed) {
      onSubmit(trimmed);
    }
  };

  if (variant === 'settings') {
    return (
      <div className="chat-settings">
        <form onSubmit={handleSubmit}>
          <div className="chat-settings-field">
            <label htmlFor="judge-chat-name">Your name (shown to admins)</label>
            <input
              id="judge-chat-name"
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Enter your name…"
              maxLength={30}
              autoFocus
            />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {onCancel && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={onCancel}
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={!nameInput.trim()}
            >
              Save
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="chat-name-prompt">
      <h3>Contact Event Staff</h3>
      <p>Your name (shown to admins)</p>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          placeholder="Enter your name…"
          maxLength={30}
          autoFocus
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!nameInput.trim()}
        >
          Continue
        </button>
      </form>
    </div>
  );
}
