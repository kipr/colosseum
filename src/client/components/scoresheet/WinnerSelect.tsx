import type { ScoresheetField } from '../../../shared/domain/scoresheetSchema';

interface WinnerSelectProps {
  field: ScoresheetField;
  formData: Record<string, unknown>;
  calculatedValues: Record<string, number>;
  onSelectWinner: (winner: 'team_a' | 'team_b') => void;
}

/**
 * The two-button "select a winner" widget shown at the bottom of head-to-head
 * scoresheets. Lifted out of `ScoresheetForm`'s inline `renderWinnerSelect`.
 */
export function WinnerSelect({
  field,
  formData,
  calculatedValues,
  onSelectWinner,
}: WinnerSelectProps) {
  const teamATotal = calculatedValues['team_a_total'] || 0;
  const teamBTotal = calculatedValues['team_b_total'] || 0;
  const teamAName = (formData.team_a_name as string) || 'Team A';
  const teamBName = (formData.team_b_name as string) || 'Team B';
  const teamANumber = (formData.team_a_number as string) || '';
  const teamBNumber = (formData.team_b_number as string) || '';
  const selectedWinner = formData.winner;

  return (
    <div key={field.id} className="winner-select-container">
      <h3 className="winner-select-title">Select Winner</h3>
      <div className="winner-options">
        <button
          type="button"
          className={`winner-button ${selectedWinner === 'team_a' ? 'selected' : ''} ${teamATotal > teamBTotal ? 'leading' : ''}`}
          onClick={() => onSelectWinner('team_a')}
          disabled={!formData.game_number || formData.team_a_number === 'Bye'}
        >
          <div className="winner-team-info">
            <span className="winner-team-number">{teamANumber}</span>
            <span className="winner-team-name">{teamAName}</span>
          </div>
          <div className="winner-team-score">{teamATotal}</div>
          {selectedWinner === 'team_a' && (
            <div className="winner-badge">✓ WINNER</div>
          )}
        </button>

        <div className="winner-vs">VS</div>

        <button
          type="button"
          className={`winner-button ${selectedWinner === 'team_b' ? 'selected' : ''} ${teamBTotal > teamATotal ? 'leading' : ''}`}
          onClick={() => onSelectWinner('team_b')}
          disabled={!formData.game_number || formData.team_b_number === 'Bye'}
        >
          <div className="winner-team-info">
            <span className="winner-team-number">{teamBNumber}</span>
            <span className="winner-team-name">{teamBName}</span>
          </div>
          <div className="winner-team-score">{teamBTotal}</div>
          {selectedWinner === 'team_b' && (
            <div className="winner-badge">✓ WINNER</div>
          )}
        </button>
      </div>
    </div>
  );
}
