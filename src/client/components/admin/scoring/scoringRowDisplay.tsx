import type { ScoreSubmission } from './types';

export interface SeedingRowDisplay {
  teamNum: string | number;
  teamName: string;
  roundLabel: string;
  total: string | number;
}

export interface BracketRowDisplay {
  team1Label: string;
  team2Label: string;
  bracketName: string;
  gameLabel: string;
  scoreLabel: string;
  winnerLabel: string;
}

/** Pull the seeding-scoresheet display fields out of a (potentially sparse) submission. */
export function getSeedingRowDisplay(
  score: ScoreSubmission,
): SeedingRowDisplay {
  const data = score.score_data || {};
  const teamNum =
    score.team_display_number ||
    data.team_number?.value ||
    data.team_a_number?.value ||
    '-';
  const teamName =
    score.team_name || data.team_name?.value || data.team_a_name?.value || '';
  const round = score.seeding_round || data.round?.value;
  const roundLabel = round ? `Round ${round}` : '-';
  const total =
    data.grand_total?.value ??
    data.team_a_total?.value ??
    data.score?.value ??
    '-';
  return { teamNum, teamName, roundLabel, total };
}

/** Pull the bracket-game display fields out of a submission, falling back to embedded score_data. */
export function getBracketRowDisplay(
  score: ScoreSubmission,
): BracketRowDisplay {
  const data = score.score_data || {};

  const team1Label =
    score.bracket_team1_display ||
    score.bracket_team1_name ||
    (score.bracket_team1_number != null
      ? String(score.bracket_team1_number)
      : null) ||
    data.team_a_name?.value ||
    data.team_a_number?.value ||
    'TBD';
  const team2Label =
    score.bracket_team2_display ||
    score.bracket_team2_name ||
    (score.bracket_team2_number != null
      ? String(score.bracket_team2_number)
      : null) ||
    data.team_b_name?.value ||
    data.team_b_number?.value ||
    'TBD';

  const bracketName = score.bracket_name || 'Bracket';
  const gameNum = score.game_number || data.game_number?.value;
  const gameLabel = gameNum ? `Game ${gameNum}` : '-';

  const team1Score =
    data.team1_score?.value ?? score.bracket_team1_score ?? null;
  const team2Score =
    data.team2_score?.value ?? score.bracket_team2_score ?? null;
  const scoreLabel =
    team1Score != null && team2Score != null
      ? `${team1Score} – ${team2Score}`
      : '-';

  let winnerLabel: string | null =
    score.bracket_winner_display ||
    score.bracket_winner_name ||
    (score.bracket_winner_number != null
      ? String(score.bracket_winner_number)
      : null) ||
    data.winner_name?.value ||
    null;

  if (!winnerLabel) {
    const winnerId =
      data.winner_team_id?.value ?? data.winner_id?.value ?? null;
    if (winnerId != null) {
      if (winnerId === score.bracket_team1_id) {
        winnerLabel = team1Label;
      } else if (winnerId === score.bracket_team2_id) {
        winnerLabel = team2Label;
      } else {
        winnerLabel = `Team ${winnerId}`;
      }
    } else {
      winnerLabel = '-';
    }
  }

  return {
    team1Label,
    team2Label,
    bracketName,
    gameLabel,
    scoreLabel,
    winnerLabel,
  };
}

/** Status pill matching the existing markup. */
export function StatusBadge({ score }: { score: ScoreSubmission }) {
  const { status, reviewed_by } = score;
  switch (status) {
    case 'accepted':
      return reviewed_by == null ? (
        <span
          className="badge badge-success"
          title="Auto-accepted by the system"
        >
          Automatically Accepted
        </span>
      ) : (
        <span className="badge badge-success">Accepted</span>
      );
    case 'rejected':
      return <span className="badge badge-danger">Rejected</span>;
    default:
      return <span className="badge badge-warning">Pending</span>;
  }
}
