import { useEffect, useState } from 'react';
import type { ScoresheetField } from '../../../shared/domain/scoresheetSchema';

/**
 * Evaluate a single calculated-field formula. Identifiers in the formula are
 * resolved against `data` first, then `calculated` (so calculated fields can
 * reference earlier calculated fields). String values are coerced to numbers
 * unless the formula contains an `=== ` comparison against the identifier, in
 * which case we substitute a quoted string so equality checks work.
 *
 * Pulled verbatim (modulo types) from the previous duplicates in
 * `ScoresheetForm` and `ScoreViewModal` so behaviour is preserved exactly.
 */
export function evaluateFormula(
  formula: string,
  data: Record<string, unknown>,
  calculated: Record<string, number>,
): number {
  let expression = formula;
  const fieldIds = formula.match(/[a-z_][a-z0-9_]*/gi) || [];
  const uniqueFieldIds = Array.from(new Set(fieldIds));

  uniqueFieldIds.forEach((fieldId) => {
    let value: unknown = 0;

    if (calculated[fieldId] !== undefined) {
      value = calculated[fieldId];
    } else if (data[fieldId] !== undefined && data[fieldId] !== '') {
      value = data[fieldId];
    }

    let replacement: string;
    if (formula.includes(`${fieldId} ===`)) {
      replacement = `'${String(value)}'`;
    } else if (typeof value === 'string') {
      replacement = String(Number(value) || 0);
    } else if (typeof value === 'boolean') {
      replacement = value ? '1' : '0';
    } else {
      replacement = String(Number(value) || 0);
    }

    const regex = new RegExp(`\\b${fieldId}\\b`, 'g');
    expression = expression.replace(regex, replacement);
  });

  try {
    const result = eval(expression);
    return Number(result) || 0;
  } catch (error) {
    console.error(
      'Formula evaluation error:',
      error,
      'Formula:',
      formula,
      'Expression:',
      expression,
    );
    return 0;
  }
}

/**
 * Walk every `calculated` field in declaration order and produce a map of
 * `{fieldId: numericValue}`. Later calculated fields can reference earlier
 * ones because we resolve them in iteration order.
 */
export function calculateAllFormulas(
  fields: ScoresheetField[],
  data: Record<string, unknown>,
): Record<string, number> {
  const calculated: Record<string, number> = {};

  fields.forEach((field) => {
    if (field.type === 'calculated' && field.formula) {
      try {
        calculated[field.id] = evaluateFormula(field.formula, data, calculated);
      } catch (error) {
        console.error(`Error calculating ${field.id}:`, error);
        calculated[field.id] = 0;
      }
    }
  });

  return calculated;
}

/**
 * React hook that recomputes calculated values whenever the form data or the
 * schema's fields array reference changes.
 */
export function useCalculatedValues(
  fields: ScoresheetField[] | undefined,
  data: Record<string, unknown>,
): Record<string, number> {
  const [values, setValues] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!fields) {
      setValues({});
      return;
    }
    setValues(calculateAllFormulas(fields, data));
  }, [fields, data]);

  return values;
}
