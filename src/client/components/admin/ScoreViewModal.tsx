/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import Modal from '../Modal';
import type { ToastNotifier } from '../Toast';
import '../../pages/Scoresheet.css';
import { formatDateTime } from '../../utils/dateUtils';
import {
  calculateRepeatableGroupDerivedRows,
  buildRepeatableGroupDerivedScoreEntries,
  buildRepeatableGroupScoreEntry,
  calculateFormulaValues,
  getRepeatableGroupRowKeys,
  normalizeRepeatableGroupRows,
  shouldAutoAppendRepeatableGroupRow,
} from '../scoresheetUtils';
import {
  CalculatedField,
  OptionButtonGroup,
  OptionSelect,
  RepeatableGroupChildInput,
  RepeatableGroupTable,
  ScoreFieldWrapper,
  ScoresheetHeading,
  getDerivedColumns,
  getRepeatableChildColumns,
  type RepeatableGroupColumn,
  type RepeatableGroupDerivedColumnDef,
} from '../scoresheet/ScoresheetFieldParts';
import type { BracketResultType } from '../../../shared/bracketResult';
import {
  isLegacyInitialsField,
  requiresTeamInitials,
  stripLegacyInitialsFields,
  type TeamInitialsSide,
} from '../../../shared/teamInitials';

interface TeamInitialsRow {
  key: string;
  team: string;
  initials: string;
}

// Where older sheets kept initials inside score_data.
const LEGACY_INITIALS_SIDES: Record<string, TeamInitialsSide> = {
  side_a_team_initials: 'team',
  side_b_team_initials: 'team_b',
  team_a_team_initials: 'team_a',
  team_b_team_initials: 'team_b',
};

interface ScoreViewModalProps {
  score: any;
  onClose: () => void;
  onSave: () => void;
  toast: ToastNotifier;
}

export default function ScoreViewModal({
  score,
  onClose,
  onSave,
  toast,
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
      const templates = await apiFetch<any[]>('/scoresheet/templates', {
        fallbackError: 'Failed to load templates',
      });

      // Find template by ID first (more reliable), then fall back to name
      let foundTemplate = templates.find(
        (t: any) => t.id === score.template_id,
      );
      if (!foundTemplate) {
        foundTemplate = templates.find(
          (t: any) => t.name === score.template_name,
        );
      }

      if (foundTemplate) {
        setTemplate(foundTemplate);
      } else {
        console.error(
          'Template not found. Score template_id:',
          score.template_id,
          'template_name:',
          score.template_name,
        );
        console.error(
          'Available templates:',
          templates.map((t: any) => ({ id: t.id, name: t.name })),
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
      calculateFormulaValues(template?.schema?.fields, formData).calculated,
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

    setFormData((prev) => {
      const rows = normalizeRepeatableGroupRows(prev[field.id], field).map(
        (row) => ({ ...row }),
      );
      rows[rowIndex] = {
        ...(rows[rowIndex] ??
          normalizeRepeatableGroupRows(undefined, field)[0]),
        [childField.id]: value,
      };

      if (
        field.autoAppendBlankRow &&
        shouldAutoAppendRepeatableGroupRow(rows, field)
      ) {
        rows.push(normalizeRepeatableGroupRows(undefined, field)[0]);
      }

      return {
        ...prev,
        [field.id]: rows,
      };
    });
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
      toast.error('Select the disqualified team and enter a private reason.');
      return;
    }

    setSaving(true);
    try {
      // Build updated score data with labels and types preserved
      const updatedScoreData: Record<string, any> = {};

      const fieldsById = new Map<string, any>(
        (template?.schema?.fields || []).map((field: any) => [field.id, field]),
      );
      const { calculated: saveCalculatedValues, derivedByFieldId } =
        calculateFormulaValues(template?.schema?.fields || [], formData);

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
      );

      await apiFetch(`/scores/${score.id}`, {
        method: 'PUT',
        body: {
          scoreData: updatedScoreData,
          resultType,
          disqualifiedTeamId:
            resultType === 'disqualification' ? disqualifiedTeamId : null,
          resultNote:
            resultType === 'disqualification' ? resultNote.trim() : null,
        },
        fallbackError: 'Failed to update score',
      });

      toast.success('Score updated successfully!');
      onSave();
    } catch (error) {
      console.error('Error updating score:', error);
      toast.error('Failed to update score');
    } finally {
      setSaving(false);
    }
  };

  const renderField = (field: any) => {
    if (field.type === 'section_header' || field.type === 'group_header') {
      return <ScoresheetHeading key={field.id} field={field} />;
    }

    if (field.type === 'calculated') {
      const calcValue =
        calculatedValues[field.id] !== undefined
          ? calculatedValues[field.id]
          : score.score_data[field.id]?.value || 0;
      return <CalculatedField key={field.id} field={field} value={calcValue} />;
    }

    if (field.type === 'repeatableGroup') {
      return renderRepeatableGroup(field);
    }

    const value = formData[field.id] !== undefined ? formData[field.id] : '';

    return (
      <ScoreFieldWrapper key={field.id} field={field}>
        {renderFieldInput(field, value)}
      </ScoreFieldWrapper>
    );
  };

  const renderFieldInput = (field: any, value: any) => {
    const disabled = isReadOnly || field.autoPopulated;

    return (
      <>
        {field.type === 'text' && (
          <input
            type="text"
            className="score-input"
            value={value}
            onChange={(e) => handleInputChange(field.id, e.target.value)}
            disabled={disabled}
          />
        )}
        {field.type === 'number' && (
          <input
            type="number"
            className="score-input"
            value={value}
            onChange={(e) => handleInputChange(field.id, e.target.value)}
            disabled={disabled}
          />
        )}
        {field.type === 'dropdown' && (
          <OptionSelect
            options={field.options}
            value={value}
            onChange={(nextValue) => handleInputChange(field.id, nextValue)}
            disabled={disabled}
            style={{ width: '100%' }}
            showUnknownValue
          />
        )}
        {field.type === 'buttons' && (
          <OptionButtonGroup
            options={field.options}
            value={value}
            onSelect={(nextValue) => handleInputChange(field.id, nextValue)}
            disabled={isReadOnly}
          />
        )}
        {field.type === 'checkbox' && (
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => handleInputChange(field.id, e.target.checked)}
            disabled={disabled}
          />
        )}
      </>
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

  const getRepeatableGroupDerivedColumns = (
    field: any,
    derivedRows: any[],
  ): RepeatableGroupDerivedColumnDef[] => {
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
    const columns = [
      ...getRepeatableChildColumns(field, rows, (childField, value, rowIndex) =>
        renderRepeatableGroupInput(field, rowIndex, childField, value),
      ),
      ...getDerivedColumns(
        getRepeatableGroupDerivedColumns(field, derivedRows),
        derivedRows,
      ),
    ];

    return (
      <RepeatableGroupTable
        key={field.id}
        title={field.label}
        suffix={field.suffix}
        rowLabel={field.rowLabel || 'Row'}
        rowCount={rows.length}
        columns={columns}
      />
    );
  };

  const renderRepeatableGroupInput = (
    field: any,
    rowIndex: number,
    childField: any,
    value: any,
  ) => (
    <RepeatableGroupChildInput
      childField={childField}
      value={value}
      onChange={(nextValue) =>
        handleRepeatableGroupInputChange(field, rowIndex, childField, nextValue)
      }
      disabled={isReadOnly || childField.autoPopulated}
      showUnknownValue
    />
  );

  const renderFallbackRepeatableGroup = (fieldId: string, data: any) => {
    const rows = Array.isArray(data.value) ? data.value : [];
    const derivedRows = Array.isArray(data.derived?.rows)
      ? data.derived.rows
      : [];
    const columns: RepeatableGroupColumn[] = [
      ...getRepeatableGroupRowKeys(rows).map((key) => ({
        key: `field:${key}`,
        label: key,
        renderCell: (rowIndex: number) => (
          <input
            type="text"
            className="score-input repeatable-group-input"
            value={String(rows[rowIndex]?.[key] ?? '')}
            disabled
          />
        ),
      })),
      ...getDerivedColumns(
        getRepeatableGroupDerivedColumns(undefined, derivedRows),
        derivedRows,
      ),
    ];

    return (
      <RepeatableGroupTable
        key={fieldId}
        title={data.label || fieldId}
        rowLabel="Row"
        rowCount={rows.length}
        columns={columns}
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
                ) && !isLegacyInitialsField({ id: fieldId }),
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
      <Modal onClose={onClose} className="score-view-modal">
        <p>Loading scoresheet...</p>
      </Modal>
    );
  }

  // Initials are shown read-only in their own panel, never as editable fields.
  const schema = template?.schema
    ? {
        ...template.schema,
        fields: stripLegacyInitialsFields(template.schema.fields ?? []),
      }
    : undefined;

  const getSideTeamLabel = (side: TeamInitialsSide): string => {
    const data = score.score_data || {};
    const number =
      side === 'team'
        ? (score.team_display_number ?? data.team_number?.value)
        : side === 'team_a'
          ? (score.bracket_team1_number ??
            score.double_seeding_team1_number ??
            data.team_a_number?.value)
          : (score.bracket_team2_number ??
            score.double_seeding_team2_number ??
            data.team_b_number?.value);
    if (number != null && number !== '') return `Team ${number}`;
    return side === 'team_a' ? 'Team A' : side === 'team_b' ? 'Team B' : 'Team';
  };

  const teamInitialsRows: TeamInitialsRow[] =
    Array.isArray(score.team_initials) && score.team_initials.length > 0
      ? score.team_initials.map((row: any) => ({
          key: row.side,
          team:
            row.team_number != null
              ? `Team ${row.team_number}`
              : getSideTeamLabel(row.side),
          initials: row.initials,
        }))
      : Object.entries(score.score_data || {})
          .filter(
            ([fieldId, data]: [string, any]) =>
              LEGACY_INITIALS_SIDES[fieldId] &&
              String(data?.value ?? '').trim(),
          )
          .map(([fieldId, data]: [string, any]) => ({
            key: fieldId,
            team: getSideTeamLabel(LEGACY_INITIALS_SIDES[fieldId]),
            initials: String(data.value).trim(),
          }));
  const showTeamInitials =
    teamInitialsRows.length > 0 || requiresTeamInitials(template?.schema);

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
    <Modal onClose={onClose} className="score-view-modal">
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

      {showTeamInitials && (
        <div className="score-view-initials-panel">
          <strong>Team initials</strong>
          {teamInitialsRows.length > 0 ? (
            <ul>
              {teamInitialsRows.map((row) => (
                <li key={row.key}>
                  {row.team}: <span>{row.initials}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span>Not recorded</span>
          )}
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
            {schema.fields.filter((f: any) => f.isGrandTotal).map(renderField)}
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
    </Modal>
  );
}
