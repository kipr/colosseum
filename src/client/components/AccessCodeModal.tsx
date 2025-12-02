import React, { useState } from 'react';
import './Modal.css';

interface AccessCodeModalProps {
  templateId: number;
  templateName: string;
  onClose: () => void;
  onSuccess: (template: any) => void;
}

export default function AccessCodeModal({ templateId, templateName, onClose, onSuccess }: AccessCodeModalProps) {
  const [accessCode, setAccessCode] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!accessCode.trim()) {
      setError('Please enter an access code');
      return;
    }

    try {
      const response = await fetch(`/scoresheet/templates/${templateId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode })
      });

      if (!response.ok) {
        if (response.status === 403) {
          setError('Invalid access code');
        } else {
          setError('Failed to verify access code');
        }
        return;
      }

      const template = await response.json();
      onSuccess(template);
    } catch (error) {
      console.error('Error verifying access code:', error);
      setError('Failed to verify access code');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit(e as any);
    }
  };

  return (
    <div className="modal show" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '450px' }} onClick={(e) => e.stopPropagation()}>
        <span className="close" onClick={onClose}>&times;</span>
        <h3>Enter Access Code</h3>
        <p style={{ color: 'var(--secondary-color)', marginBottom: '1.5rem' }}>
          Template: {templateName}
        </p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Access Code:</label>
            <input
              type="text"
              className="field-input"
              placeholder="Enter code provided by administrator"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              onKeyPress={handleKeyPress}
              autoComplete="off"
              autoFocus
            />
          </div>
          {error && (
            <div style={{ color: 'var(--danger-color)', marginBottom: '1rem' }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Access Scoresheet
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

