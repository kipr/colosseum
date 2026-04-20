import React, { useState, useEffect, useMemo } from 'react';
import '../Modal.css';
import '../../pages/Scoresheet.css';
import { formatDateTime } from '../../utils/dateUtils';
import {
  type ScoresheetSchema,
  tryParseScoresheetSchema,
} from '../../../shared/domain/scoresheetSchema';
import { ScoresheetFieldList } from '../scoresheet/ScoresheetFieldList';
import { useCalculatedValues } from '../scoresheet/formulaEngine';

interface StoredScoreField {
  label: string;
  value: unknown;
  type: string;
}

interface Score {
  id: number;
  status: string;
  created_at: string;
  template_id: number;
  template_name: string;
  score_type?: string;
  score_data: Record<string, StoredScoreField>;
}

interface ScoreViewModalProps {
  score: Score;
  onClose: () => void;
  onSave: () => void;
}

interface RawTemplate {
  id: number;
  name: string;
  schema: unknown;
}

interface TemplateWithSchema {
  id: number;
  name: string;
  schema: ScoresheetSchema | null;
}

export default function ScoreViewModal({
  score,
  onClose,
  onSave,
}: ScoreViewModalProps) {
  const [template, setTemplate] = useState<TemplateWithSchema | null>(null);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const isReadOnly = score.status !== 'pending';

  const calculatedValues = useCalculatedValues(
    template?.schema?.fields,
    formData,
  );

  const storedCalculatedValues = useMemo(() => {
    const out: Record<string, number> = {};
    Object.entries(score.score_data).forEach(([fieldId, fieldData]) => {
      const v = fieldData?.value;
      if (typeof v === 'number') out[fieldId] = v;
      else if (typeof v === 'string' && v !== '' && !isNaN(Number(v))) {
        out[fieldId] = Number(v);
      }
    });
    return out;
  }, [score.score_data]);

  useEffect(() => {
    loadTemplate();
    initializeFormData();
  }, []);

  const loadTemplate = async () => {
    try {
      const response = await fetch('/scoresheet/templates');
      if (!response.ok) throw new Error('Failed to load templates');
      const templates: RawTemplate[] = await response.json();

      let foundTemplate = templates.find((t) => t.id === score.template_id);
      if (!foundTemplate) {
        foundTemplate = templates.find((t) => t.name === score.template_name);
      }

      if (foundTemplate) {
        const parsed = tryParseScoresheetSchema(foundTemplate.schema);
        if (parsed.ok) {
          setTemplate({
            id: foundTemplate.id,
            name: foundTemplate.name,
            schema: parsed.value,
          });
        } else {
          console.warn(
            'Score template schema failed validation; rendering fallback for template id',
            foundTemplate.id,
            parsed.error,
          );
          setTemplate({
            id: foundTemplate.id,
            name: foundTemplate.name,
            schema: null,
          });
        }
      } else {
        console.error(
          'Template not found. Score template_id:',
          score.template_id,
          'template_name:',
          score.template_name,
        );
        console.error(
          'Available templates:',
          templates.map((t) => ({ id: t.id, name: t.name })),
        );
      }
    } catch (error) {
      console.error('Error loading template:', error);
    } finally {
      setLoading(false);
    }
  };

  const initializeFormData = () => {
    const data: Record<string, unknown> = {};
    Object.entries(score.score_data).forEach(([fieldId, fieldData]) => {
      data[fieldId] = fieldData.value;
    });
    setFormData(data);
  };

  const handleInputChange = (fieldId: string, value: unknown) => {
    if (isReadOnly) return;
    setFormData((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleSave = async () => {
    if (isReadOnly) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const updatedScoreData: Record<string, StoredScoreField> = {};

      Object.entries(score.score_data).forEach(([fieldId, fieldData]) => {
        updatedScoreData[fieldId] = {
          ...fieldData,
          value:
            formData[fieldId] !== undefined
              ? formData[fieldId]
              : fieldData.value,
        };
      });

      Object.entries(calculatedValues).forEach(([fieldId, value]) => {
        if (updatedScoreData[fieldId]) {
          updatedScoreData[fieldId].value = value;
        }
      });

      const response = await fetch(`/scores/${score.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ scoreData: updatedScoreData }),
      });

      if (!response.ok) throw new Error('Failed to update score');

      alert('Score updated successfully!');
      onSave();
    } catch (error) {
      console.error('Error updating score:', error);
      alert('Failed to update score');
    } finally {
      setSaving(false);
    }
  };

  // Fallback: render raw data in scoresheet-like format when the template
  // schema can't be loaded or doesn't validate.
  const renderFallbackScoreData = () => {
    return (
      <div className="scoresheet-form">
        <div className="scoresheet-title">
          Score Details (Template Not Found)
        </div>
        <div className="scoresheet-header-fields">
          {Object.entries(score.score_data)
            .filter(([key]) =>
              ['team_number', 'team_name', 'round'].includes(key),
            )
            .map(([fieldId, data]) => (
              <div key={fieldId} className="score-field">
                <label className="score-label">{data.label}</label>
                <input
                  type="text"
                  className="score-input"
                  value={String(data.value)}
                  disabled
                />
              </div>
            ))}
        </div>

        <div style={{ marginTop: '1rem' }}>
          {Object.entries(score.score_data)
            .filter(
              ([fieldId]) =>
                !['team_number', 'team_name', 'round', 'grand_total'].includes(
                  fieldId,
                ),
            )
            .map(([fieldId, data]) => (
              <div key={fieldId} className="score-field">
                <label className="score-label">{data.label}</label>
                {data.type === 'buttons' ? (
                  <div className="score-button-group">
                    <button className="score-option-button selected" disabled>
                      {String(data.value)}
                    </button>
                  </div>
                ) : (
                  <input
                    type="text"
                    className="score-input"
                    value={String(data.value)}
                    disabled
                    style={{ width: data.type === 'number' ? '70px' : '100%' }}
                  />
                )}
              </div>
            ))}
        </div>

        {score.score_data.grand_total && (
          <div className="score-field grand-total-field">
            <label className="score-label">
              {score.score_data.grand_total.label}
            </label>
            <div className="calculated-value">
              {String(score.score_data.grand_total.value)}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="modal show" onClick={onClose}>
        <div
          className="modal-content score-view-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="close" onClick={onClose}>
            &times;
          </span>
          <p>Loading scoresheet...</p>
        </div>
      </div>
    );
  }

  const schema = template?.schema ?? null;

  const isBracket = score.score_type === 'bracket';
  const winnerDisplay = isBracket
    ? (() => {
        const data = score.score_data || {};
        const winnerNum = data.winner_team_number?.value;
        const winnerName = data.winner_team_name?.value;
        const winner = data.winner?.value;
        if (winnerNum != null && winnerName != null) {
          return `${winnerNum} - ${winnerName}`;
        }
        if (data.winner_display?.value)
          return String(data.winner_display.value);
        if (winner === 'team_a') {
          const n = data.team_a_number?.value ?? '';
          const name = data.team_a_name?.value ?? '';
          return name ? `${n} - ${name}` : String(n) || 'Team A';
        }
        if (winner === 'team_b') {
          const n = data.team_b_number?.value ?? '';
          const name = data.team_b_name?.value ?? '';
          return name ? `${n} - ${name}` : String(n) || 'Team B';
        }
        return null;
      })()
    : null;

  return (
    <div className="modal show" onClick={onClose}>
      <div
        className="modal-content score-view-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="close" onClick={onClose}>
          &times;
        </span>

        <div className="score-view-header">
          <h3>{isReadOnly ? 'View Score' : 'Edit Score'}</h3>
          <div className="score-view-meta">
            <span
              className={`badge badge-${score.status === 'accepted' ? 'success' : score.status === 'rejected' ? 'danger' : 'warning'}`}
            >
              {score.status.charAt(0).toUpperCase() + score.status.slice(1)}
            </span>
            <span>Submitted: {formatDateTime(score.created_at)}</span>
          </div>
        </div>

        {isBracket && winnerDisplay && (
          <div
            className="score-view-winner-banner"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.75rem 1rem',
              marginBottom: '1rem',
              background: 'var(--primary-color)',
              color: 'white',
              borderRadius: '0.5rem',
              fontWeight: 600,
              fontSize: '1.1rem',
            }}
          >
            <span
              style={{
                fontSize: '1.25rem',
                lineHeight: 1,
              }}
              aria-hidden
            >
              ✓
            </span>
            <span>Winner: {winnerDisplay}</span>
          </div>
        )}

        <div className="score-view-form">
          {!template || !schema ? (
            renderFallbackScoreData()
          ) : (
            <ScoresheetFieldList
              schema={schema}
              mode={isReadOnly ? 'readonly' : 'edit'}
              formData={formData}
              calculatedValues={calculatedValues}
              storedCalculatedValues={storedCalculatedValues}
              onChange={handleInputChange}
              showWinnerSelect={false}
              formClassName="scoresheet-form"
              formStyle={{ boxShadow: 'none', padding: 0 }}
            />
          )}
        </div>

        <div className="score-view-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            {isReadOnly ? 'Close' : 'Cancel'}
          </button>
          {!isReadOnly && (
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
