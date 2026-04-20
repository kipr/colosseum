import React, { type ReactNode } from 'react';
import type {
  ScoresheetField as ScoresheetFieldT,
  ScoresheetSchema,
} from '../../../shared/domain/scoresheetSchema';
import {
  ScoresheetField,
  type BracketDropdownProps,
  type DynamicDropdownItem,
  type ScoresheetFieldMode,
} from './ScoresheetField';

export interface ScoresheetFieldListProps {
  schema: ScoresheetSchema;
  mode: ScoresheetFieldMode;
  formData?: Record<string, unknown>;
  calculatedValues?: Record<string, number>;
  /** Pre-existing values (e.g. from `score_data`) used as fallback for calculated fields in readonly/preview. */
  storedCalculatedValues?: Record<string, number>;
  touchedFields?: Record<string, boolean>;
  onChange?: (id: string, value: unknown, field: ScoresheetFieldT) => void;
  onNumberInputTouched?: (id: string, touched: boolean) => void;
  /** Per-dropdown dynamic options (keyed by field id) loaded from a `dataSource`. */
  dynamicData?: Record<string, DynamicDropdownItem[]>;
  bracket?: BracketDropdownProps;
  /** Allows a parent to inject a richer winner-select UI. */
  renderWinnerSelect?: (field: ScoresheetFieldT) => ReactNode;
  /**
   * Predicate to skip header fields (e.g. the judge form hides team_number /
   * round when using the queue picker). Applied only to the header row.
   */
  excludeHeaderFieldId?: (fieldId: string) => boolean;
  /** When false, omit the winner-select row entirely. */
  showWinnerSelect?: boolean;
  /** Optional extra class for the outer scoresheet-form wrapper. */
  formClassName?: string;
  /** Optional inline style for the outer scoresheet-form wrapper. */
  formStyle?: React.CSSProperties;
  /** Title to render above the fields (defaults to `schema.title`). */
  title?: string | null;
  /** Render the title row. Set false when the parent renders its own title bar. */
  showTitle?: boolean;
}

/**
 * Renders a complete scoresheet body (title, header fields, columned body,
 * grand totals, optional winner select) using a single field-rendering engine.
 *
 * All three call sites (`ScoresheetForm`, `ScoreViewModal`, `TemplatePreviewModal`)
 * delegate to this component; mode-specific behaviour is selected via the
 * `mode` prop.
 */
export function ScoresheetFieldList({
  schema,
  mode,
  formData,
  calculatedValues,
  storedCalculatedValues,
  touchedFields,
  onChange,
  onNumberInputTouched,
  dynamicData,
  bracket,
  renderWinnerSelect,
  excludeHeaderFieldId,
  showWinnerSelect = true,
  formClassName = 'scoresheet-form',
  formStyle,
  title,
  showTitle = true,
}: ScoresheetFieldListProps): React.JSX.Element {
  const isHeadToHead = schema.mode === 'head-to-head';
  const fields = schema.fields;

  const headerFields = fields.filter((f) => {
    if (f.column) return false;
    if (
      f.type === 'section_header' ||
      f.type === 'group_header' ||
      f.type === 'calculated' ||
      f.type === 'winner-select'
    ) {
      return false;
    }
    if (excludeHeaderFieldId && excludeHeaderFieldId(f.id)) return false;
    return true;
  });

  const renderField = (field: ScoresheetFieldT) => (
    <ScoresheetField
      key={field.id}
      field={field}
      mode={mode}
      value={formData?.[field.id]}
      calculatedValue={calculatedValues?.[field.id]}
      storedCalculatedValue={storedCalculatedValues?.[field.id]}
      touched={!!touchedFields?.[field.id]}
      onChange={onChange}
      onNumberInputTouched={onNumberInputTouched}
      dynamicOptions={dynamicData?.[field.id]}
      bracket={field.dataSource?.type === 'bracket' ? bracket : undefined}
      renderWinnerSelect={renderWinnerSelect}
    />
  );

  const resolvedTitle = title === undefined ? schema.title : title;

  return (
    <div className={formClassName} style={formStyle}>
      {showTitle && resolvedTitle && (
        <div className="scoresheet-title">{resolvedTitle}</div>
      )}

      <div className="scoresheet-header-fields">
        {headerFields.map(renderField)}
      </div>

      {schema.layout === 'two-column' ? (
        <div className="scoresheet-columns">
          <div className="scoresheet-column">
            {fields.filter((f) => f.column === 'left').map(renderField)}
          </div>
          <div className="scoresheet-column">
            {fields.filter((f) => f.column === 'right').map(renderField)}
          </div>
        </div>
      ) : (
        <div>
          {fields
            .filter(
              (f) =>
                !f.column &&
                f.type !== 'section_header' &&
                f.type !== 'group_header' &&
                f.type !== 'winner-select',
            )
            .map(renderField)}
        </div>
      )}

      {isHeadToHead &&
        showWinnerSelect &&
        fields.filter((f) => f.type === 'winner-select').map(renderField)}

      {fields.filter((f) => f.isGrandTotal).map(renderField)}
    </div>
  );
}
