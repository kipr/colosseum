import { useMemo, useState } from 'react';
import { Modal, ModalActions } from '../../Modal';
import { UnifiedTable } from '../../table';
import { parseDocScoresText } from '../documentationBulkImport';
import type { DocCategory } from './types';

interface BulkImportModalProps {
  open: boolean;
  categories: DocCategory[];
  importing: boolean;
  results: {
    success: number;
    errors: { index: number; error: string }[];
  } | null;
  onClose: () => void;
  onImport: (input: {
    bulkText: string;
    selectedCategoryId: string;
    parsed: { team_number: number; scores: number[] }[];
  }) => Promise<void>;
}

/** Modal that pastes CSV/TSV scores and previews them before import. */
export function BulkImportModal({
  open,
  categories,
  importing,
  results,
  onClose,
  onImport,
}: BulkImportModalProps) {
  const [bulkText, setBulkText] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.ordinal - b.ordinal),
    [categories],
  );
  const selectedBulkCategory =
    sortedCategories.find((cat) => String(cat.id) === selectedCategoryId) ??
    null;
  const previewCategories = selectedBulkCategory
    ? [selectedBulkCategory]
    : sortedCategories;

  const { rows: parsed, errors: parseErrors } = parseDocScoresText(
    bulkText,
    previewCategories.length,
  );

  const handleClose = () => {
    setBulkText('');
    setSelectedCategoryId('');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Bulk Import Documentation Scores"
      maxWidth={700}
    >
      <div className="form-group">
        <label htmlFor="bulk-doc-category">Category</label>
        <select
          id="bulk-doc-category"
          className="field-input"
          value={selectedCategoryId}
          onChange={(e) => setSelectedCategoryId(e.target.value)}
        >
          <option value="">All categories</option>
          {sortedCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>
      <p style={{ color: 'var(--secondary-color)', marginBottom: '1rem' }}>
        {selectedBulkCategory
          ? `Paste CSV or TSV. Format: team_number, ${selectedBulkCategory.name} score. Optional header row (skipped if first column is non-numeric).`
          : 'Paste CSV or TSV. Format: team_number, score1, score2, ... (scores in category ordinal order). Optional header row (skipped if first column is non-numeric).'}
      </p>
      <p
        style={{
          color: 'var(--secondary-color)',
          marginBottom: '1rem',
          fontSize: '0.875rem',
        }}
      >
        Expected columns: 1 + {previewCategories.length} ={' '}
        {1 + previewCategories.length} (team_number +{' '}
        {previewCategories.map((c) => c.name).join(', ')})
      </p>
      <div className="form-group">
        <label htmlFor="bulk-doc-text">Data</label>
        <textarea
          id="bulk-doc-text"
          className="field-input"
          rows={10}
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder={
            selectedBulkCategory
              ? 'Example:\n101\t15\n102\t20'
              : 'Example:\n101\t15\t18\t12\n102\t20\t16\t14'
          }
        />
      </div>
      {parsed.length > 0 && (
        <div className="bulk-preview" style={{ marginBottom: '1rem' }}>
          <h4>Preview ({parsed.length} rows)</h4>
          <UnifiedTable
            columns={[
              {
                kind: 'data',
                id: 'team_number',
                header: { full: 'Team #' },
                renderCell: (row) => row.team_number,
              },
              ...previewCategories.map((c, idx) => ({
                kind: 'data' as const,
                id: `score-${c.id}`,
                header: { full: c.name },
                renderCell: (row: { team_number: number; scores: number[] }) =>
                  row.scores[idx],
              })),
            ]}
            rows={parsed.slice(0, 10)}
            getRowKey={(row) => `${row.team_number}-${row.scores.join(',')}`}
            headerLabelVariant="none"
            wrapperClassName="bulk-preview-table"
            tbodyExtra={
              parsed.length > 10 ? (
                <tr>
                  <td
                    colSpan={1 + previewCategories.length}
                    style={{
                      textAlign: 'center',
                      fontStyle: 'italic',
                    }}
                  >
                    ...and {parsed.length - 10} more
                  </td>
                </tr>
              ) : null
            }
          />
        </div>
      )}
      {parseErrors.length > 0 && (
        <div className="bulk-errors" style={{ marginBottom: '1rem' }}>
          <h4>Parse Errors</h4>
          <ul>
            {parseErrors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}
      {results && (
        <div className="bulk-results" style={{ marginBottom: '1rem' }}>
          <h4>Import Results</h4>
          <p>
            Success: <strong>{results.success}</strong>
          </p>
          {results.errors.length > 0 && (
            <>
              <p>
                Failed: <strong>{results.errors.length}</strong>
              </p>
              <ul>
                {results.errors.map((e) => (
                  <li key={e.index}>
                    Row {e.index + 1}: {e.error}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <ModalActions>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleClose}
        >
          Close
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onImport({ bulkText, selectedCategoryId, parsed })}
          disabled={importing || parsed.length === 0 || parseErrors.length > 0}
        >
          {importing ? 'Importing...' : `Import ${parsed.length} Row(s)`}
        </button>
      </ModalActions>
    </Modal>
  );
}
