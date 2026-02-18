import React, { useState } from 'react';
import {
  BracketDetail,
  BracketStatus,
  GameStatus,
  STATUS_LABELS,
  GAME_STATUS_LABELS,
} from '../../types/brackets';
import BracketLikeView from './BracketLikeView';
import './BracketDisplay.css';

type DetailViewMode = 'management' | 'bracket';

export function getStatusClass(status: BracketStatus): string {
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

export function getGameStatusClass(status: GameStatus): string {
  switch (status) {
    case 'pending':
      return 'game-status-pending';
    case 'ready':
      return 'game-status-ready';
    case 'in_progress':
      return 'game-status-in-progress';
    case 'completed':
      return 'game-status-completed';
    case 'bye':
      return 'game-status-bye';
    default:
      return '';
  }
}

export function getBracketWinner(games: BracketDetail['games']): {
  team_id: number;
  team_number?: number;
  team_name?: string;
  team_display?: string | null;
} | null {
  const championshipGames = games.filter(
    (g) => g.winner_advances_to_id === null,
  );
  if (championshipGames.length === 0) return null;
  const champ = championshipGames.reduce((a, b) =>
    (a.game_number ?? 0) > (b.game_number ?? 0) ? a : b,
  );
  if (!champ.winner_id) return null;
  return {
    team_id: champ.winner_id,
    team_number: champ.winner_number,
    team_name: champ.winner_name,
    team_display: champ.winner_display,
  };
}

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

interface BracketDetailViewProps {
  bracketDetail: BracketDetail;
  onBack: () => void;
  adminActions?: React.ReactNode;
  entriesActions?: React.ReactNode;
  gamesActions?: React.ReactNode;
}

export default function BracketDetailView({
  bracketDetail,
  onBack,
  adminActions,
  entriesActions,
  gamesActions,
}: BracketDetailViewProps) {
  const [detailViewMode, setDetailViewMode] =
    useState<DetailViewMode>('management');

  const winner =
    bracketDetail.games.length > 0
      ? getBracketWinner(bracketDetail.games)
      : null;

  return (
    <>
      <div className="brackets-controls">
        <button className="btn btn-secondary" onClick={onBack}>
          ← Back to List
        </button>
        {bracketDetail.games.length > 0 && (
          <div className="view-mode-toggle">
            <button
              className={`btn ${detailViewMode === 'management' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDetailViewMode('management')}
            >
              Management View
            </button>
            <button
              className={`btn ${detailViewMode === 'bracket' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDetailViewMode('bracket')}
            >
              Bracket View
            </button>
          </div>
        )}
      </div>

      {/* Bracket Header */}
      <div className="card bracket-header-card">
        <div className="bracket-header">
          <div className="bracket-header-info">
            <h3>{bracketDetail.name}</h3>
            <div className="bracket-meta">
              <span>
                <strong>Size:</strong> {bracketDetail.bracket_size}
              </span>
              <span>
                <strong>Teams:</strong>{' '}
                {bracketDetail.actual_team_count || 'Not set'}
              </span>
              <span
                className={`bracket-status-badge ${getStatusClass(bracketDetail.status)}`}
              >
                {STATUS_LABELS[bracketDetail.status]}
              </span>
            </div>
          </div>
          {adminActions && (
            <div className="bracket-header-actions">{adminActions}</div>
          )}
        </div>
      </div>

      {/* Winner Banner - Management View */}
      {detailViewMode === 'management' && winner && (
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

      {/* Bracket-like View */}
      {detailViewMode === 'bracket' && (
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
      )}

      {/* Management View: Entries + Games Sections */}
      {detailViewMode === 'management' && (
        <>
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
                            ? 'Losers Bracket'
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
      )}
    </>
  );
}
