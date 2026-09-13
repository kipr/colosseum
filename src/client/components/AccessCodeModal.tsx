import React, { useState } from 'react';
import { ApiError } from '../api/http';
import { useVerifyTemplateMutation } from '../queries/templates';
import type { TemplateDetail } from '../api/templates';
import './Modal.css';

interface AccessCodeModalProps {
  templateId: number;
  templateName: string;
  onClose: () => void;
  onSuccess: (template: TemplateDetail) => void;
}

export default function AccessCodeModal({
  templateId,
  templateName,
  onClose,
  onSuccess,
}: AccessCodeModalProps) {
  const [accessCode, setAccessCode] = useState('');
  const [error, setError] = useState('');
  const verify = useVerifyTemplateMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!accessCode.trim()) {
      setError('Please enter an access code');
      return;
    }
    if (verify.isPending) return;

    try {
      const template = await verify.mutateAsync({ templateId, accessCode });
      onSuccess(template);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('Invalid access code');
        return;
      }
      setError('Failed to verify access code');
    }
  };

  return (
    <div className="modal show" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '450px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="close" onClick={onClose}>
          &times;
        </span>
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
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={verify.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={verify.isPending}
            >
              {verify.isPending ? 'Verifying...' : 'Access Scoresheet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
