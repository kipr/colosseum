import React, { useMemo } from 'react';
import { UnifiedTable } from '../table';
import type { UnifiedColumnDef } from '../table';
import { Bracket, BracketStatus, STATUS_LABELS } from '../../types/brackets';
import { formatDateTime } from '../../utils/dateUtils';
import './BracketDisplay.css';

function getStatusClass(status: BracketStatus): string {
  switch (status) {
    case 'setup':
      return 'status-setup';
    case 'in_progress':
      return 'status-in-progress';
    case 'completed':
      return 'status-completed';
    default:
      return '';
  }
}

interface BracketListTableProps {
  brackets: Bracket[];
  onSelect: (id: number) => void;
  onDelete?: (bracket: Bracket) => void;
}

export default function BracketListTable({
  brackets,
  onSelect,
  onDelete,
}: BracketListTableProps) {
  const columns: UnifiedColumnDef<Bracket>[] = useMemo(
    () => [
      {
        kind: 'data',
        id: 'name',
        header: { full: 'Name' },
        renderCell: (bracket) => <strong>{bracket.name}</strong>,
      },
      {
        kind: 'data',
        id: 'size',
        header: { full: 'Size' },
        renderCell: (bracket) => bracket.bracket_size,
      },
      {
        kind: 'data',
        id: 'teams',
        header: { full: 'Teams' },
        renderCell: (bracket) => bracket.actual_team_count || '—',
      },
      {
        kind: 'data',
        id: 'status',
        header: { full: 'Status' },
        renderCell: (bracket) => (
          <span
            className={`bracket-status-badge ${getStatusClass(bracket.status)}`}
          >
            {STATUS_LABELS[bracket.status]}
          </span>
        ),
      },
      {
        kind: 'data',
        id: 'created',
        header: { full: 'Created' },
        renderCell: (bracket) => formatDateTime(bracket.created_at),
      },
      {
        kind: 'data',
        id: 'actions',
        header: { full: 'Actions' },
        renderCell: (bracket) => (
          <div className="bracket-actions">
            <button
              className="btn btn-primary"
              onClick={() => onSelect(bracket.id)}
            >
              View
            </button>
            {onDelete && (
              <button
                className="btn btn-danger"
                onClick={() => onDelete(bracket)}
              >
                Delete
              </button>
            )}
          </div>
        ),
      },
    ],
    [onDelete, onSelect],
  );

  if (brackets.length === 0) {
    return (
      <p style={{ color: 'var(--secondary-color)' }}>
        No brackets created for this event yet.
      </p>
    );
  }

  return (
    <UnifiedTable
      columns={columns}
      rows={brackets}
      getRowKey={(b) => b.id}
      headerLabelVariant="none"
    />
  );
}
