import {
  STATUS_LABELS,
  type BracketDetail,
  type BracketStatus,
} from '../../../types/brackets';

interface AdminActionsProps {
  bracketDetail: BracketDetail | null;
  onEdit: () => void;
  onStatusChange: (status: BracketStatus) => void;
}

interface EntriesActionsProps {
  bracketDetail: BracketDetail | null;
  generating: boolean;
  onGenerate: () => void;
}

interface GamesActionsProps {
  bracketDetail: BracketDetail | null;
  generating: boolean;
  onGenerate: () => void;
}

/** Header buttons displayed on the bracket detail page (Edit/Start/Reopen/etc.). */
export function renderAdminActions({
  bracketDetail,
  onEdit,
  onStatusChange,
}: AdminActionsProps) {
  if (!bracketDetail) return null;
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

/** "Generate from Seeding" button, only shown when the bracket has no entries. */
export function renderEntriesActions({
  bracketDetail,
  generating,
  onGenerate,
}: EntriesActionsProps) {
  if (!bracketDetail || bracketDetail.entries.length > 0) return null;
  return (
    <button
      className="btn btn-primary"
      onClick={onGenerate}
      disabled={generating}
    >
      {generating ? 'Generating...' : 'Generate from Seeding'}
    </button>
  );
}

/** "Generate Games" / "Clear ALL Games and Regenerate" button. */
export function renderGamesActions({
  bracketDetail,
  generating,
  onGenerate,
}: GamesActionsProps) {
  if (!bracketDetail) return null;
  return (
    <button
      className={`btn ${bracketDetail.games.length > 0 ? 'btn-danger' : 'btn-primary'}`}
      onClick={onGenerate}
      disabled={generating || bracketDetail.entries.length === 0}
      title={bracketDetail.entries.length === 0 ? 'Generate entries first' : ''}
    >
      {generating
        ? 'Generating...'
        : bracketDetail.games.length > 0
          ? 'Clear ALL Games and Regenerate'
          : 'Generate Games'}
    </button>
  );
}

/** Friendly label for a bracket status code. */
export function statusLabel(status: BracketStatus): string {
  return STATUS_LABELS[status];
}
