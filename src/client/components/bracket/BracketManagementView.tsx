import React from 'react';
import { BracketDetail } from '../../types/brackets';
import { GAME_STATUS_LABELS } from '../../types/brackets';
import { getBracketWinner, getGameStatusClass } from './bracketUtils';
import './BracketDisplay.css';

function renderTeamDisplay(
  teamId: number | null,
  teamNumber?: number,
  teamName?: string,
  teamDisplay?: string | null,
) {
  if (!teamId) {
    return <span className="team-tbd">TBD</span>;
  }
  return (
    <span className="team-name">
      <strong>{teamNumber}</strong> {teamName || teamDisplay}
    </span>
  );
}

interface BracketManagementViewProps {
  bracketDetail: BracketDetail;
  entriesActions?: React.ReactNode;
  gamesActions?: React.ReactNode;
}

export default function BracketManagementView({
  bracketDetail,
  entriesActions,
  gamesActions,
}: BracketManagementViewProps) {
  const winner =
    bracketDetail.games.length > 0
      ? getBracketWinner(bracketDetail.games)
      : null;

  return (
    <>
      {winner && (
        <div className="bracket-winner-banner bracket-winner-management">
          <span className="bracket-winner-trophy" aria-hidden>
            🏆
          </span>
          <div className="bracket-winner-content">
            <span className="bracket-winner-label">Bracket Champion</span>
            <span className="bracket-winner-team">
              <strong>{winner.team_number}</strong>{' '}
              {winner.team_name ||
                winner.team_display ||
                `Team ${winner.team_id}`}
            </span>
          </div>
        </div>
      )}

      {/* Entries Section */}
      <div className="card bracket-section">
        <div className="bracket-section-header">
          <h4>Bracket Entries ({bracketDetail.entries.length})</h4>
          {entriesActions}
        </div>

        {bracketDetail.entries.length === 0 ? (
          <p style={{ color: 'var(--secondary-color)' }}>No entries yet.</p>
        ) : (
          <div className="entries-grid">
            {bracketDetail.entries.map((entry) => (
              <div
                key={entry.id}
                className={`entry-card ${entry.is_bye ? 'entry-bye' : ''}`}
              >
                <span className="entry-seed">#{entry.seed_position}</span>
                {entry.is_bye ? (
                  <span className="entry-bye-label">BYE</span>
                ) : (
                  <span className="entry-team">
                    <strong>{entry.team_number}</strong>{' '}
                    {entry.team_name || entry.display_name}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Games Section */}
      <div className="card bracket-section">
        <div className="bracket-section-header">
          <h4>Bracket Games ({bracketDetail.games.length})</h4>
          {gamesActions}
        </div>

        {bracketDetail.games.length === 0 ? (
          <p style={{ color: 'var(--secondary-color)' }}>No games yet.</p>
        ) : (
          <div className="games-list">
            {['winners', 'losers', 'finals'].map((side) => {
              const sideGames = bracketDetail.games.filter(
                (g) => g.bracket_side === side,
              );
              if (sideGames.length === 0) return null;

              return (
                <div key={side} className="games-side-group">
                  <h5 className="games-side-title">
                    {side === 'winners'
                      ? 'Winners Bracket'
                      : side === 'losers'
                        ? 'Redemption Bracket'
                        : 'Finals'}
                  </h5>
                  <table className="games-table">
                    <thead>
                      <tr>
                        <th>Game</th>
                        <th>Round</th>
                        <th>Team 1</th>
                        <th>Team 2</th>
                        <th>Status</th>
                        <th>Winner</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sideGames.map((game) => (
                        <tr key={game.id}>
                          <td>
                            <strong>Game {game.game_number}</strong>
                          </td>
                          <td>{game.round_name || '—'}</td>
                          <td>
                            {renderTeamDisplay(
                              game.team1_id,
                              game.team1_number,
                              game.team1_name,
                              game.team1_display,
                            )}
                          </td>
                          <td>
                            {renderTeamDisplay(
                              game.team2_id,
                              game.team2_number,
                              game.team2_name,
                              game.team2_display,
                            )}
                          </td>
                          <td>
                            <span
                              className={`game-status-badge ${getGameStatusClass(game.status)}`}
                            >
                              {GAME_STATUS_LABELS[game.status]}
                            </span>
                          </td>
                          <td>
                            {game.winner_id
                              ? renderTeamDisplay(
                                  game.winner_id,
                                  game.winner_number,
                                  game.winner_name,
                                  game.winner_display,
                                )
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
