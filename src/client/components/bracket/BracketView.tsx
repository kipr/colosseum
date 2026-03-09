import React from 'react';
import { BracketDetail } from '../../types/brackets';
import { getBracketWinner } from './bracketUtils';
import BracketLikeView from './BracketLikeView';
import './BracketDisplay.css';

interface BracketViewProps {
  bracketDetail: BracketDetail;
}

export default function BracketView({ bracketDetail }: BracketViewProps) {
  const winner =
    bracketDetail.games.length > 0
      ? getBracketWinner(bracketDetail.games)
      : null;

  return (
    <div className="card bracket-section">
      {winner && (
        <div className="bracket-winner-banner bracket-winner-bracket-view">
          <span className="bracket-winner-trophy" aria-hidden>
            🏆
          </span>
          <span className="bracket-winner-label">Champion</span>
          <span className="bracket-winner-team">
            <strong>{winner.team_number}</strong>{' '}
            {winner.team_name ||
              winner.team_display ||
              `Team ${winner.team_id}`}
          </span>
        </div>
      )}
      <BracketLikeView games={bracketDetail.games} />
    </div>
  );
}
