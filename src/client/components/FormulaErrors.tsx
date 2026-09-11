import type { FormulaDiagnostic } from '../../shared/scoreFormulaEval';

export default function FormulaErrors({
  errors,
  summary = false,
}: {
  errors: FormulaDiagnostic[];
  summary?: boolean;
}) {
  if (!errors.length) return null;
  return (
    <div role={summary ? 'alert' : undefined} className="formula-errors">
      {summary && (
        <strong>Correct these formula errors before continuing:</strong>
      )}
      <ul>
        {errors.map((error, index) => (
          <li key={index}>
            {error.field ? `${error.field}: ` : ''}
            {error.message}
            {error.offset !== undefined ? ` (offset ${error.offset})` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}
