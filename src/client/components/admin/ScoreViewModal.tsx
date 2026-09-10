/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from 'react';
import '../Modal.css';
import '../../pages/Scoresheet.css';
import { formatDateTime } from '../../utils/dateUtils';
import {
  calculateRepeatableGroupDerivedRows,
  buildRepeatableGroupDerivedScoreEntries,
  buildRepeatableGroupScoreEntry,
  calculateRepeatableGroupDerivedValues,
  calculateScoresheetValues,
  applyRepeatableGroupInputChange,
  getRepeatableGroupRowKeys,
  normalizeRepeatableGroupRows,
  shouldAutoAppendRepeatableGroupRow,
} from '../scoresheetUtils';
import type { BracketResultType } from '../../../shared/bracketResult';
import { loadAdminScoreTemplate } from '../../utils/adminScoreTemplate';
import {
  buildTeamInitialsScoreEntries,
  getMissingTeamInitialsError,
  getRequiredTeamInitialsSlots,
  inferEventScoreType,
  isTeamInitialsFieldId,
  type EventScoreType,
} from '../../../shared/teamInitials';
import TeamInitialsFields from '../TeamInitialsFields';
import ScoresheetFieldControl from '../ScoresheetFieldControl';
import RepeatableGroupTable from '../RepeatableGroupTable';

interface ScoreViewModalProps {
  score: any;
  onClose: () => void;
  onSave: () => void;
}

export default function ScoreViewModal({
  score,
  onClose,
  onSave,
}: ScoreViewModalProps) {
  const [template, setTemplate] = useState<any>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [calculatedValues, setCalculatedValues] = useState<
    Record<string, number>
  >({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [resultType, setResultType] = useState<BracketResultType>(
    score.result_type ?? 'standard',
  );
  const [disqualifiedTeamId, setDisqualifiedTeamId] = useState<number | null>(
    score.disqualified_team_id ?? null,
  );
  const [resultNote, setResultNote] = useState(score.result_note ?? '');
  const isReadOnly = score.status !== 'pending';
  const eventScoreType: EventScoreType | null =
    score.score_type === 'seeding' ||
    score.score_type === 'bracket' ||
    score.score_type === 'double_seeding'
      ? score.score_type
      : inferEventScoreType(template?.schema);
  const teamInitialsSlots =
    eventScoreType == null || score.event_id == null
      ? []
      : getRequiredTeamInitialsSlots({
          scoreType: eventScoreType,
          hasTeamB:
            eventScoreType === 'bracket' ||
            (eventScoreType === 'double_seeding' &&
              (score.double_seeding_team2_id != null ||
                formData.team_b_id != null)),
        });

  useEffect(() => {
    loadTemplate();
    initializeFormData();
  }, []);

  useEffect(() => {
    if (template) {
      calculateAllFormulas();
    }
  }, [formData, template]);

  const loadTemplate = async () => {
    try {
      const foundTemplate = await loadAdminScoreTemplate(score);
      if (foundTemplate) {
        setTemplate(foundTemplate);
      } else {
        console.error(
          'Template not found. Score template_id:',
          score.template_id,
          'template_name:',
          score.template_name,
        );
      }
    } catch (error) {
      console.error('Error loading template:', error);
    } finally {
      setLoading(false);
    }
  };

  const initializeFormData = () => {
    const data: Record<string, any> = {};
    Object.entries(score.score_data).forEach(
      ([fieldId, fieldData]: [string, any]) => {
        data[fieldId] = fieldData.value;
      },
    );
    setFormData(data);
  };

  const calculateAllFormulas = () => {
    setCalculatedValues(
      calculateScoresheetValues(template?.schema?.fields, formData),
    );
  };

  const handleDisqualifiedTeamChange = (teamId: number | null) => {
    setDisqualifiedTeamId(teamId);
    if (teamId == null) return;

    const disqualifiedIsTeam1 = teamId === score.bracket_team1_id;
    const winnerId = disqualifiedIsTeam1
      ? score.bracket_team2_id
      : score.bracket_team1_id;
    const winnerNumber = disqualifiedIsTeam1
      ? score.bracket_team2_number
      : score.bracket_team1_number;
    const winnerName = disqualifiedIsTeam1
      ? score.bracket_team2_name
      : score.bracket_team1_name;
    const winnerDisplay = disqualifiedIsTeam1
      ? score.bracket_team2_display
      : score.bracket_team1_display;

    setFormData((previous) => ({
      ...previous,
      winner: disqualifiedIsTeam1 ? 'team_b' : 'team_a',
      winner_team_id: winnerId,
      winner_team_number: winnerNumber,
      winner_team_name: winnerName,
      winner_display: winnerDisplay,
    }));
  };

  const handleInputChange = (fieldId: string, value: any) => {
    if (isReadOnly) return;
    setFormData((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleRepeatableGroupInputChange = (
    field: any,
    rowIndex: number,
    childField: any,
    value: any,
  ) => {
    if (isReadOnly) return;

    setFormData((prev) => ({
      ...prev,
      [field.id]: applyRepeatableGroupInputChange(
        prev[field.id],
        field,
        rowIndex,
        childField.id,
        value,
      ),
    }));
  };

  const handleSave = async () => {
    if (isReadOnly) {
      onClose();
      return;
    }
    if (
      resultType === 'disqualification' &&
      (disqualifiedTeamId == null || !resultNote.trim())
    ) {
      alert('Select the disqualified team and enter a private reason.');
      return;
    }
    if (teamInitialsSlots.length > 0) {
      const initialsError = getMissingTeamInitialsError(
        formData,
        teamInitialsSlots,
      );
      if (initialsError) {
        alert(initialsError);
        return;
      }
    }

    setSaving(true);
    try {
      // Build updated score data with labels and types preserved
      const updatedScoreData: Record<string, any> = {};

      const fieldsById = new Map<string, any>(
        (template?.schema?.fields || []).map((field: any) => [field.id, field]),
      );
      const saveCalculatedValues = calculateScoresheetValues(
        template?.schema?.fields,
        formData,
      );
      const { derivedByFieldId } = calculateRepeatableGroupDerivedValues(
        template?.schema?.fields || [],
        formData,
      );

      Object.entries(score.score_data).forEach(
        ([fieldId, fieldData]: [string, any]) => {
          const field = fieldsById.get(fieldId);

          if (field?.type === 'repeatableGroup') {
            updatedScoreData[fieldId] = buildRepeatableGroupScoreEntry(
              field,
              fieldData,
              formData[fieldId] !== undefined
                ? formData[fieldId]
                : fieldData.value,
              derivedByFieldId[fieldId],
            );
          } else {
            updatedScoreData[fieldId] = {
              ...fieldData,
              value:
                formData[fieldId] !== undefined
                  ? formData[fieldId]
                  : fieldData.value,
            };
          }
        },
      );

      // Update calculated values
      Object.entries(saveCalculatedValues).forEach(([fieldId, value]) => {
        if (updatedScoreData[fieldId]) {
          updatedScoreData[fieldId].value = value;
        }
      });

      Object.assign(
        updatedScoreData,
        buildRepeatableGroupDerivedScoreEntries(
          template?.schema?.fields || [],
          derivedByFieldId,
        ),
        buildTeamInitialsScoreEntries(formData, teamInitialsSlots),
      );

      const response = await fetch(`/scores/${score.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          scoreData: updatedScoreData,
          resultType,
          disqualifiedTeamId:
            resultType === 'disqualification' ? disqualifiedTeamId : null,
          resultNote:
            resultType === 'disqualification' ? resultNote.trim() : null,
        }),
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

  const renderField = (field: any) => {
    if (isTeamInitialsFieldId(field.id)) {
      return null;
    }

    if (field.type === 'section_header') {
      return (
        <div key={field.id} className="section-header">
          {field.label}
        </div>
      );
    }

    if (field.type === 'group_header') {
      return (
        <div key={field.id} className="group-header">
          {field.label}
        </div>
      );
    }

    if (field.type === 'calculated') {
      const calcValue =
        calculatedValues[field.id] !== undefined
          ? calculatedValues[field.id]
          : score.score_data[field.id]?.value || 0;
      const className = field.isGrandTotal
        ? 'grand-total-field'
        : field.isTotal
          ? 'total-field'
          : 'subtotal-field';
      return (
        <div key={field.id} className={`score-field ${className}`}>
          <label
            className="score-label"
            style={{
              fontWeight: field.isTotal || field.isGrandTotal ? 700 : 600,
            }}
          >
            {field.label}
          </label>
          <div className="calculated-value">{calcValue}</div>
        </div>
      );
    }

    if (field.type === 'repeatableGroup') {
      return renderRepeatableGroup(field);
    }

    const value = formData[field.id] !== undefined ? formData[field.id] : '';
    const isCompact =
      field.type === 'number' ||
      field.type === 'buttons' ||
      field.type === 'checkbox';

    if (field.isMultiplier) {
      return (
        <div key={field.id} className="score-field multiplier-field">
          <label className="score-label">
            <span className="multiplier-label">Multiplier:</span> {field.label}
            {field.suffix && <span className="multiplier">{field.suffix}</span>}
          </label>
          {renderFieldInput(field, value, isCompact)}
        </div>
      );
    }

    return (
      <div
        key={field.id}
        className={`score-field ${isCompact ? 'compact' : ''}`}
      >
        <label className="score-label">
          {field.label}
          {field.suffix && <span className="multiplier">{field.suffix}</span>}
        </label>
        {renderFieldInput(field, value, isCompact)}
      </div>
    );
  };

  const renderFieldInput = (field: any, value: any, isCompact: boolean) => {
    const disabled = isReadOnly || field.autoPopulated;

    return (
      <ScoresheetFieldControl
        field={field}
        value={value}
        onChange={(nextValue) => handleInputChange(field.id, nextValue)}
        disabled={field.type === 'buttons' ? isReadOnly : disabled}
        isCompact={isCompact}
        numberUi="native"
        includeOrphanDropdownValue
        compareSelectionAsString
      />
    );
  };

  const getRepeatableGroupRowsForRender = (
    field: any,
  ): Array<Record<string, any>> => {
    const submittedRows = Array.isArray(score.score_data?.[field.id]?.value)
      ? score.score_data[field.id].value
      : [];

    if (isReadOnly) {
      return submittedRows;
    }

    const rows = normalizeRepeatableGroupRows(formData[field.id], field);

    if (
      field.autoAppendBlankRow &&
      shouldAutoAppendRepeatableGroupRow(rows, field)
    ) {
      return [...rows, normalizeRepeatableGroupRows(undefined, field)[0]];
    }

    return rows;
  };

  const getRepeatableGroupDerivedRows = (field: any, rows: any[]) => {
    if (!isReadOnly && field.derived) {
      return calculateRepeatableGroupDerivedRows(field, rows);
    }

    const submittedRows = score.score_data?.[field.id]?.derived?.rows;
    return Array.isArray(submittedRows) ? submittedRows : [];
  };

  const getRepeatableGroupDerivedColumns = (field: any, derivedRows: any[]) => {
    const columns =
      field?.derived?.type === 'botballStartBoxCubes'
        ? [{ key: 'subtotal', label: 'Value' }]
        : [
            { key: 'status', label: 'Status' },
            { key: 'sortedColor', label: 'Sorted Color' },
            { key: 'color', label: 'Sorted Color' },
            { key: 'equivalent', label: 'Equivalent' },
            { key: 'subtotal', label: 'Subtotal' },
          ];
    const usedLabels = new Set<string>();

    return columns.filter((column) => {
      if (usedLabels.has(column.label)) {
        return false;
      }

      const hasValue = derivedRows.some(
        (row) =>
          row &&
          typeof row === 'object' &&
          row[column.key] !== undefined &&
          row[column.key] !== null &&
          row[column.key] !== '',
      );

      if (hasValue) {
        usedLabels.add(column.label);
      }

      return hasValue;
    });
  };

  const renderRepeatableGroup = (field: any) => {
    const rows = getRepeatableGroupRowsForRender(field);
    const derivedRows = getRepeatableGroupDerivedRows(field, rows);
    const derivedColumns = getRepeatableGroupDerivedColumns(field, derivedRows);

    return (
      <RepeatableGroupTable
        key={field.id}
        field={field}
        rows={rows}
        derivedColumns={derivedColumns}
        derivedRows={derivedRows}
        renderControl={(childField, value, rowIndex) =>
          renderRepeatableGroupInput(field, rowIndex, childField, value)
        }
      />
    );
  };

  const renderRepeatableGroupInput = (
    field: any,
    rowIndex: number,
    childField: any,
    value: any,
  ) => (
    <ScoresheetFieldControl
      field={childField}
      value={value}
      onChange={(nextValue) =>
        handleRepeatableGroupInputChange(field, rowIndex, childField, nextValue)
      }
      disabled={isReadOnly || childField.autoPopulated}
      numberUi="native"
      includeNumberBounds
      includeOrphanDropdownValue
      compareSelectionAsString
      placeholder={
        childField.type === 'number'
          ? childField.placeholder || '0'
          : childField.placeholder || ''
      }
      inputClassName="score-input repeatable-group-input"
      numberClassName="score-input repeatable-group-number"
      buttonGroupClassName="score-button-group repeatable-group-buttons"
    />
  );

  const renderFallbackRepeatableGroup = (fieldId: string, data: any) => {
    const rows = Array.isArray(data.value) ? data.value : [];
    const derivedRows = Array.isArray(data.derived?.rows)
      ? data.derived.rows
      : [];
    const rowKeys = getRepeatableGroupRowKeys(rows);
    const derivedColumns = getRepeatableGroupDerivedColumns(
      undefined,
      derivedRows,
    );

    return (
      <RepeatableGroupTable
        key={fieldId}
        field={{ id: fieldId, label: data.label || fieldId }}
        rows={rows}
        supportedFields={rowKeys.map((key) => ({
          id: key,
          label: key,
          type: 'text',
        }))}
        derivedColumns={derivedColumns}
        derivedRows={derivedRows}
        renderControl={(childField, value) => (
          <ScoresheetFieldControl
            field={childField}
            value={String(value ?? '')}
            disabled
            inputClassName="score-input repeatable-group-input"
          />
        )}
      />
    );
  };

  // Fallback: render raw data in scoresheet-like format
  const renderFallbackScoreData = () => {
    return (
      <div className="scoresheet-form">
        <div className="scoresheet-title">
          Score Details (Template Not Found)
        </div>
        <div className="scoresheet-header-fields">
          {Object.entries(score.score_data)
            .filter(([key]: [string, any]) =>
              ['team_number', 'team_name', 'round'].includes(key),
            )
            .map(([fieldId, data]: [string, any]) => (
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
              ([fieldId]: [string, any]) =>
                !['team_number', 'team_name', 'round', 'grand_total'].includes(
                  fieldId,
                ),
            )
            .map(([fieldId, data]: [string, any]) =>
              data.type === 'repeatableGroup' || Array.isArray(data.value) ? (
                renderFallbackRepeatableGroup(fieldId, data)
              ) : (
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
                      style={{
                        width: data.type === 'number' ? '70px' : '100%',
                      }}
                    />
                  )}
                </div>
              ),
            )}
        </div>

        {score.score_data.grand_total && (
          <div className="score-field grand-total-field">
            <label className="score-label">
              {score.score_data.grand_total.label}
            </label>
            <div className="calculated-value">
              {score.score_data.grand_total.value}
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

  const schema = template?.schema;

  // Derive winner display for bracket games
  const isBracket = score.score_type === 'bracket';
  const resultLabel =
    resultType === 'no_contest'
      ? 'No contest'
      : resultType === 'disqualification'
        ? 'Disqualification'
        : 'Standard score';
  const winnerDisplay = isBracket
    ? (() => {
        const data = score.score_data || {};
        const winnerNum = data.winner_team_number?.value;
        const winnerName = data.winner_team_name?.value;
        const winner = data.winner?.value;
        if (winnerNum != null && winnerName != null) {
          return `${winnerNum} - ${winnerName}`;
        }
        if (data.winner_display?.value) return data.winner_display.value;
        if (winner === 'team_a') {
          const n = data.team_a_number?.value ?? '';
          const name = data.team_a_name?.value ?? '';
          return name ? `${n} - ${name}` : n || 'Team A';
        }
        if (winner === 'team_b') {
          const n = data.team_b_number?.value ?? '';
          const name = data.team_b_name?.value ?? '';
          return name ? `${n} - ${name}` : n || 'Team B';
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

        {isBracket && (
          <div className="score-view-result-panel">
            <label>
              Result
              <select
                className="score-input"
                value={resultType}
                disabled={isReadOnly}
                onChange={(event) => {
                  const next = event.target.value as BracketResultType;
                  setResultType(next);
                  if (next !== 'disqualification') {
                    setDisqualifiedTeamId(null);
                    setResultNote('');
                  }
                }}
              >
                <option value="standard">Normal score</option>
                <option value="no_contest">No contest</option>
                <option value="disqualification">Disqualification</option>
              </select>
            </label>
            {resultType === 'disqualification' && (
              <>
                <label>
                  Disqualified team
                  <select
                    className="score-input"
                    value={disqualifiedTeamId ?? ''}
                    disabled={isReadOnly}
                    onChange={(event) =>
                      handleDisqualifiedTeamChange(
                        Number(event.target.value) || null,
                      )
                    }
                  >
                    <option value="">Select team...</option>
                    {score.bracket_team1_id != null && (
                      <option value={score.bracket_team1_id}>
                        {score.bracket_team1_display ||
                          score.bracket_team1_name ||
                          score.bracket_team1_number}
                      </option>
                    )}
                    {score.bracket_team2_id != null && (
                      <option value={score.bracket_team2_id}>
                        {score.bracket_team2_display ||
                          score.bracket_team2_name ||
                          score.bracket_team2_number}
                      </option>
                    )}
                  </select>
                </label>
                <label>
                  Private reason or rule reference
                  <textarea
                    className="score-input"
                    rows={3}
                    maxLength={1000}
                    value={resultNote}
                    disabled={isReadOnly}
                    onChange={(event) => setResultNote(event.target.value)}
                  />
                </label>
              </>
            )}
            {isReadOnly && <strong>{resultLabel}</strong>}
          </div>
        )}

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
            <span>
              {resultType === 'standard'
                ? `Winner: ${winnerDisplay}`
                : `Winner by ${resultLabel.toLowerCase()}: ${winnerDisplay}`}
            </span>
          </div>
        )}

        <div className="score-view-form">
          {!template || !schema ? (
            renderFallbackScoreData()
          ) : (
            <div
              className="scoresheet-form"
              style={{ boxShadow: 'none', padding: 0 }}
            >
              {schema.title && (
                <div className="scoresheet-title">{schema.title}</div>
              )}

              <div className="scoresheet-header-fields">
                {schema.fields
                  .filter(
                    (f: any) =>
                      !f.column &&
                      f.type !== 'section_header' &&
                      f.type !== 'group_header' &&
                      f.type !== 'calculated',
                  )
                  .map(renderField)}
              </div>

              {schema.layout === 'two-column' ? (
                <div className="scoresheet-columns">
                  <div className="scoresheet-column">
                    {schema.fields
                      .filter((f: any) => f.column === 'left')
                      .map(renderField)}
                  </div>
                  <div className="scoresheet-column">
                    {schema.fields
                      .filter((f: any) => f.column === 'right')
                      .map(renderField)}
                  </div>
                </div>
              ) : (
                <div>
                  {schema.fields
                    .filter(
                      (f: any) =>
                        !f.column &&
                        f.type !== 'section_header' &&
                        f.type !== 'group_header',
                    )
                    .map(renderField)}
                </div>
              )}

              {/* Render grand total */}
              {schema.fields
                .filter((f: any) => f.isGrandTotal)
                .map(renderField)}

              <TeamInitialsFields
                slots={teamInitialsSlots}
                values={formData}
                onChange={handleInputChange}
                disabled={isReadOnly}
                required={false}
              />
            </div>
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
