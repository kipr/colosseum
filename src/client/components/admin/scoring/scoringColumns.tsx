import type { UnifiedColumnDef } from '../../table';
import { formatDateTime } from '../../../utils/dateUtils';
import {
  StatusBadge,
  getBracketRowDisplay,
  getSeedingRowDisplay,
} from './scoringRowDisplay';
import type { ScoreSubmission } from './types';

interface ColumnArgs {
  showType: boolean;
  renderActions: (score: ScoreSubmission) => React.ReactNode;
}

const reviewedColumn: UnifiedColumnDef<ScoreSubmission> = {
  kind: 'data',
  id: 'reviewed',
  header: { full: 'Reviewed' },
  renderCell: (score) => (
    <>
      {score.reviewer_name || '-'}
      {score.reviewed_at && (
        <>
          <br />
          <small>{formatDateTime(score.reviewed_at)}</small>
        </>
      )}
    </>
  ),
};

/** Column set for the seeding score table. */
export function buildSeedingColumns({
  showType,
  renderActions,
}: ColumnArgs): UnifiedColumnDef<ScoreSubmission>[] {
  const cols: UnifiedColumnDef<ScoreSubmission>[] = [];
  if (showType) {
    cols.push({
      kind: 'data',
      id: 'type',
      header: { full: 'Type' },
      renderCell: () => <span className="badge badge-info">Seeding</span>,
    });
  }
  cols.push(
    {
      kind: 'data',
      id: 'team',
      header: { full: 'Team' },
      renderCell: (score) => {
        const { teamNum, teamName } = getSeedingRowDisplay(score);
        return (
          <>
            <div>
              <strong>{teamNum}</strong>
            </div>
            {teamName && (
              <small style={{ color: 'var(--text-secondary)' }}>
                {teamName}
              </small>
            )}
          </>
        );
      },
    },
    {
      kind: 'data',
      id: 'round',
      header: { full: 'Round' },
      renderCell: (score) => getSeedingRowDisplay(score).roundLabel,
    },
    {
      kind: 'data',
      id: 'total',
      header: { full: 'Total' },
      renderCell: (score) => (
        <strong style={{ color: 'var(--primary-color)' }}>
          {getSeedingRowDisplay(score).total}
        </strong>
      ),
    },
    {
      kind: 'data',
      id: 'submitted',
      header: { full: 'Submitted' },
      renderCell: (score) => formatDateTime(score.created_at),
    },
    {
      kind: 'data',
      id: 'status',
      header: { full: 'Status' },
      renderCell: (score) => <StatusBadge score={score} />,
    },
    reviewedColumn,
    {
      kind: 'data',
      id: 'actions',
      header: { full: 'Actions' },
      renderCell: (score) => renderActions(score),
    },
  );
  return cols;
}

/** Column set for the bracket score table. */
export function buildBracketColumns({
  showType,
  renderActions,
}: ColumnArgs): UnifiedColumnDef<ScoreSubmission>[] {
  const cols: UnifiedColumnDef<ScoreSubmission>[] = [];
  if (showType) {
    cols.push({
      kind: 'data',
      id: 'type',
      header: { full: 'Type' },
      renderCell: () => <span className="badge badge-purple">Bracket</span>,
    });
  }
  cols.push(
    {
      kind: 'data',
      id: 'matchup',
      header: { full: 'Matchup' },
      renderCell: (score) => {
        const { team1Label, team2Label } = getBracketRowDisplay(score);
        return (
          <div className="bracket-matchup-cell">
            <span>{team1Label}</span>
            <span className="bracket-vs">vs</span>
            <span>{team2Label}</span>
          </div>
        );
      },
    },
    {
      kind: 'data',
      id: 'game',
      header: { full: 'Game' },
      renderCell: (score) => getBracketRowDisplay(score).gameLabel,
    },
    {
      kind: 'data',
      id: 'score',
      header: { full: 'Score' },
      renderCell: (score) => (
        <strong style={{ color: 'var(--primary-color)' }}>
          {getBracketRowDisplay(score).scoreLabel}
        </strong>
      ),
    },
    {
      kind: 'data',
      id: 'winner',
      header: { full: 'Winner' },
      renderCell: (score) => (
        <span className="bracket-winner-cell">
          {getBracketRowDisplay(score).winnerLabel}
        </span>
      ),
    },
    {
      kind: 'data',
      id: 'submitted',
      header: { full: 'Submitted' },
      renderCell: (score) => formatDateTime(score.created_at),
    },
    {
      kind: 'data',
      id: 'status',
      header: { full: 'Status' },
      renderCell: (score) => <StatusBadge score={score} />,
    },
    reviewedColumn,
    {
      kind: 'data',
      id: 'actions',
      header: { full: 'Actions' },
      renderCell: (score) => renderActions(score),
    },
  );
  return cols;
}
