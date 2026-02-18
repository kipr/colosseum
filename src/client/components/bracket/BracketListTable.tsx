import React from 'react';
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
  if (brackets.length === 0) {
    return (
      <p style={{ color: 'var(--secondary-color)' }}>
        No brackets created for this event yet.
      </p>
    );
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Size</th>
          <th>Teams</th>
          <th>Status</th>
          <th>Created</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {brackets.map((bracket) => (
          <tr key={bracket.id}>
            <td>
              <strong>{bracket.name}</strong>
            </td>
            <td>{bracket.bracket_size}</td>
            <td>{bracket.actual_team_count || '—'}</td>
            <td>
              <span
                className={`bracket-status-badge ${getStatusClass(bracket.status)}`}
              >
                {STATUS_LABELS[bracket.status]}
              </span>
            </td>
            <td>{formatDateTime(bracket.created_at)}</td>
            <td>
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
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
