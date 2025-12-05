import React, { useState, useRef, useEffect } from 'react';
import { useChat } from '../contexts/ChatContext';
import './PublicChat.css';

export default function PublicChat() {
  const {
    isOpen,
    setIsOpen,
    chatName,
    setChatName,
    needsNamePrompt,
    spreadsheets,
    selectedSpreadsheet,
    setSelectedSpreadsheet,
    messages,
    sendMessage,
    clearChat,
    isLoading,
    view,
    setView,
    isAdmin,
    hasUnreadMessages,
    clearUnread,
  } = useChat();

  const [inputMessage, setInputMessage] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [settingsNameInput, setSettingsNameInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Initialize settings name input when opening settings
  useEffect(() => {
    if (view === 'settings' && chatName) {
      setSettingsNameInput(chatName);
    }
  }, [view, chatName]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;
    
    await sendMessage(inputMessage.trim());
    setInputMessage('');
  };

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (nameInput.trim()) {
      setChatName(nameInput.trim());
    }
  };

  const handleSettingsSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (settingsNameInput.trim() && !isAdmin) {
      setChatName(settingsNameInput.trim());
    }
    setView('list');
  };

  const handleSpreadsheetSelect = (spreadsheet: typeof selectedSpreadsheet) => {
    setSelectedSpreadsheet(spreadsheet);
    setView('chat');
  };

  const handleBack = () => {
    if (view === 'chat') {
      setSelectedSpreadsheet(null);
      setView('list');
    } else if (view === 'settings') {
      setView('list');
    }
  };

  const handleClearChat = async () => {
    if (!isAdmin) return;
    const confirmed = window.confirm('Are you sure you want to clear all messages in this chat? This cannot be undone.');
    if (confirmed) {
      await clearChat();
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  // Group messages by date
  const groupedMessages = messages.reduce((groups, message) => {
    const date = formatDate(message.created_at);
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(message);
    return groups;
  }, {} as Record<string, typeof messages>);

  const handleToggleChat = () => {
    if (!isOpen) {
      // Opening chat - clear unread notification
      clearUnread();
    }
    setIsOpen(!isOpen);
  };

  return (
    <>
      {/* Chat Toggle Button */}
      <button
        className={`chat-toggle-btn ${isOpen ? 'open' : ''}`}
        onClick={handleToggleChat}
        aria-label={isOpen ? 'Close chat' : 'Open chat'}
      >
        {isOpen ? (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
          </svg>
        )}
        {/* Notification badge for unread messages */}
        {hasUnreadMessages && !isOpen && (
          <span className="chat-notification-badge" />
        )}
      </button>

      {/* Chat Panel */}
      {isOpen && (
        <div className="chat-panel">
          {/* Name Prompt for non-admin first-time users */}
          {needsNamePrompt ? (
            <div className="chat-name-prompt">
              <h3>Welcome to Chat</h3>
              <p>Please enter a name to start chatting:</p>
              <form onSubmit={handleNameSubmit}>
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Enter your name..."
                  maxLength={30}
                  autoFocus
                />
                <button type="submit" className="btn btn-primary" disabled={!nameInput.trim()}>
                  Start Chatting
                </button>
              </form>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="chat-header">
                {view !== 'list' && (
                  <button className="chat-back-btn" onClick={handleBack}>
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                    </svg>
                  </button>
                )}
                <h3>
                  {view === 'list' && 'Chat Rooms'}
                  {view === 'chat' && selectedSpreadsheet?.spreadsheet_name}
                  {view === 'settings' && 'Settings'}
                </h3>
                {view === 'list' && (
                  <button className="chat-settings-btn" onClick={() => setView('settings')}>
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
                    </svg>
                  </button>
                )}
                {/* Clear chat button for admins */}
                {view === 'chat' && isAdmin && (
                  <button 
                    className="chat-clear-btn" 
                    onClick={handleClearChat}
                    title="Clear all messages"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                    </svg>
                  </button>
                )}
              </div>

              {/* Content */}
              <div className="chat-content">
                {/* Spreadsheet List View */}
                {view === 'list' && (
                  <div className="chat-room-list">
                    {spreadsheets.length === 0 ? (
                      <div className="chat-empty">
                        <p>No active spreadsheets available.</p>
                        <small>Chat rooms will appear when spreadsheets are linked.</small>
                      </div>
                    ) : (
                      spreadsheets.map((spreadsheet) => (
                        <button
                          key={spreadsheet.spreadsheet_id}
                          className="chat-room-item"
                          onClick={() => handleSpreadsheetSelect(spreadsheet)}
                        >
                          <span className="chat-room-icon">💬</span>
                          <span className="chat-room-name">{spreadsheet.spreadsheet_name}</span>
                          <svg className="chat-room-arrow" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
                          </svg>
                        </button>
                      ))
                    )}
                  </div>
                )}

                {/* Chat View */}
                {view === 'chat' && (
                  <>
                    <div className="chat-messages">
                      {isLoading && messages.length === 0 ? (
                        <div className="chat-loading">Loading messages...</div>
                      ) : messages.length === 0 ? (
                        <div className="chat-empty">
                          <p>No messages yet.</p>
                          <small>Be the first to say something!</small>
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
                                className={`chat-message ${msg.sender_name === chatName ? 'own' : ''} ${msg.is_admin ? 'admin' : ''}`}
                              >
                                <div className="chat-message-header">
                                  <span className="chat-sender">
                                    {msg.sender_name}
                                    {Boolean(msg.is_admin) && <span className="admin-badge">Admin</span>}
                                  </span>
                                  <span className="chat-time">{formatTime(msg.created_at)}</span>
                                </div>
                                <div className="chat-message-body">{msg.message}</div>
                              </div>
                            ))}
                          </div>
                        ))
                      )}
                      <div ref={messagesEndRef} />
                    </div>
                    <form className="chat-input-form" onSubmit={handleSendMessage}>
                      <input
                        type="text"
                        value={inputMessage}
                        onChange={(e) => setInputMessage(e.target.value)}
                        placeholder="Type a message..."
                        maxLength={1000}
                      />
                      <button type="submit" disabled={!inputMessage.trim()}>
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                        </svg>
                      </button>
                    </form>
                  </>
                )}

                {/* Settings View */}
                {view === 'settings' && (
                  <div className="chat-settings">
                    <form onSubmit={handleSettingsSave}>
                      <div className="chat-settings-field">
                        <label>Display Name</label>
                        <input
                          type="text"
                          value={isAdmin ? chatName || '' : settingsNameInput}
                          onChange={(e) => setSettingsNameInput(e.target.value)}
                          placeholder="Enter your name..."
                          maxLength={30}
                          disabled={isAdmin}
                          className={isAdmin ? 'disabled' : ''}
                        />
                        {isAdmin && (
                          <small className="admin-note">
                            Admin names are set from your Google account and cannot be changed.
                          </small>
                        )}
                      </div>
                      <button type="submit" className="btn btn-primary">
                        {isAdmin ? 'Close' : 'Save Changes'}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

