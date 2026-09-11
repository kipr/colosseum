import type { ReactNode } from 'react';
import type { BracketDetail, BracketStatus } from '../../../types/brackets';

interface BracketAdminToolbarProps {
  bracketDetail: BracketDetail;
  generatingEntries: boolean;
  generatingGames: boolean;
  onEdit: () => void;
  onStatusChange: (status: BracketStatus) => void;
  onGenerateEntries: () => void;
  onGenerateGames: () => void;
}

export function renderAdminActions(
  bracketDetail: BracketDetail,
  onEdit: () => void,
  onStatusChange: (status: BracketStatus) => void,
): ReactNode {
  return (
    <>
      <button className="btn btn-secondary" onClick={onEdit}>
        Edit
      </button>
      {bracketDetail.status === 'setup' && (
        <button
          className="btn btn-success"
          onClick={() => onStatusChange('in_progress')}
        >
          Start Bracket
        </button>
      )}
      {bracketDetail.status === 'in_progress' && (
        <>
          <button
            className="btn btn-primary"
            onClick={() => onStatusChange('completed')}
          >
            Mark Complete
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => onStatusChange('setup')}
          >
            Back to Setup
          </button>
        </>
      )}
      {bracketDetail.status === 'completed' && (
        <button
          className="btn btn-secondary"
          onClick={() => onStatusChange('in_progress')}
        >
          Reopen
        </button>
      )}
    </>
  );
}

export function renderEntriesActions(
  bracketDetail: BracketDetail,
  generatingEntries: boolean,
  onGenerateEntries: () => void,
): ReactNode {
  if (bracketDetail.entries.length > 0) return null;
  return (
    <button
      className="btn btn-primary"
      onClick={onGenerateEntries}
      disabled={generatingEntries}
    >
      {generatingEntries ? 'Generating...' : 'Generate from Seeding'}
    </button>
  );
}

export function renderGamesActions(
  bracketDetail: BracketDetail,
  generatingGames: boolean,
  onGenerateGames: () => void,
): ReactNode {
  return (
    <button
      className={`btn ${bracketDetail.games.length > 0 ? 'btn-danger' : 'btn-primary'}`}
      onClick={onGenerateGames}
      disabled={generatingGames || bracketDetail.entries.length === 0}
      title={bracketDetail.entries.length === 0 ? 'Generate entries first' : ''}
    >
      {generatingGames
        ? 'Generating...'
        : bracketDetail.games.length > 0
          ? 'Clear ALL Games and Regenerate'
          : 'Generate Games'}
    </button>
  );
}

export default function BracketAdminToolbar({
  bracketDetail,
  generatingEntries,
  generatingGames,
  onEdit,
  onStatusChange,
  onGenerateEntries,
  onGenerateGames,
}: BracketAdminToolbarProps) {
  return (
    <>
      {renderAdminActions(bracketDetail, onEdit, onStatusChange)}
      {renderEntriesActions(
        bracketDetail,
        generatingEntries,
        onGenerateEntries,
      )}
      {renderGamesActions(bracketDetail, generatingGames, onGenerateGames)}
    </>
  );
}
