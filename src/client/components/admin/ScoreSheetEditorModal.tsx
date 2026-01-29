/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react';
import TemplateEditorModal from './TemplateEditorModal';
import ScoreSheetWizard from './ScoreSheetWizard';
import '../Modal.css';

interface ScoreSheetEditorModalProps {
  scoreSheetId: number | null;
  onClose: () => void;
  onSave: () => void;
}

export default function ScoreSheetEditorModal({
  scoreSheetId,
  onClose,
  onSave,
}: ScoreSheetEditorModalProps) {
  const [mode, setMode] = useState<'choice' | 'wizard' | 'manual' | null>(
    scoreSheetId ? 'manual' : 'choice', // If editing existing, go straight to manual mode
  );
  const [wizardData, setWizardData] = useState<any>(null);

  // If editing an existing score sheet, go directly to the manual editor
  if (scoreSheetId) {
    return (
      <TemplateEditorModal
        templateId={scoreSheetId}
        onClose={onClose}
        onSave={onSave}
      />
    );
  }

  // Show choice dialog for new score sheets
  if (mode === 'choice') {
    return (
      <div
        className="modal show"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div
          className="modal-content"
          style={{ maxWidth: '600px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="close" onClick={onClose}>
            &times;
          </span>

          <h3>Create New Score Sheet</h3>
          <p style={{ color: 'var(--secondary-color)', marginBottom: '2rem' }}>
            Choose how you'd like to create your score sheet:
          </p>

          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
          >
            <button
              className="btn btn-primary"
              onClick={() => setMode('wizard')}
              style={{
                padding: '1.5rem',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}
              >
                <span style={{ fontSize: '2rem' }}>🧙‍♂️</span>
                <div>
                  <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                    Use Score Sheet Generator
                  </div>
                  <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>
                    Guided wizard to generate a basic seeding or DE score sheet
                  </div>
                </div>
              </div>
            </button>

            <button
              className="btn btn-secondary"
              onClick={() => setMode('manual')}
              style={{
                padding: '1.5rem',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}
              >
                <span style={{ fontSize: '2rem' }}>📝</span>
                <div>
                  <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                    Paste JSON Manually
                  </div>
                  <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>
                    For advanced users or custom score sheets
                  </div>
                </div>
              </div>
            </button>
          </div>

          <div style={{ marginTop: '2rem', textAlign: 'center' }}>
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show wizard
  if (mode === 'wizard') {
    return (
      <ScoreSheetWizard
        onComplete={(data) => {
          setWizardData(data);
          setMode('manual');
        }}
        onCancel={() => setMode('choice')}
      />
    );
  }

  // Show manual editor (with wizard data pre-filled if coming from wizard)
  return (
    <TemplateEditorModal
      templateId={null}
      onClose={onClose}
      onSave={onSave}
      initialData={wizardData}
    />
  );
}
