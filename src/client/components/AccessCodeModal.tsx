/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react';
import { ApiError, apiFetch } from '../utils/api';
import Modal from './Modal';

interface AccessCodeModalProps {
  templateId: number;
  templateName: string;
  onClose: () => void;
  onSuccess: (template: any) => void;
}

export default function AccessCodeModal({
  templateId,
  templateName,
  onClose,
  onSuccess,
}: AccessCodeModalProps) {
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
      const template = await apiFetch(
        `/scoresheet/templates/${templateId}/verify`,
        { method: 'POST', body: { accessCode } },
      );
      onSuccess(template);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setError('Invalid access code');
        return;
      }
      if (!(error instanceof ApiError)) {
        console.error('Error verifying access code:', error);
      }
      setError('Failed to verify access code');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit(e as any);
    }
  };

  return (
    <Modal onClose={onClose} size="450px">
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
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            justifyContent: 'flex-end',
          }}
        >
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Access Scoresheet
          </button>
        </div>
      </form>
    </Modal>
  );
}
