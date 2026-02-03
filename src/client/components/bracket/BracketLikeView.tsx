import React, { useState, useMemo, useEffect } from 'react';
import {
  BracketGame,
  BracketSide,
  GameStatus,
  GAME_STATUS_DISPLAY_LABELS,
  BRACKET_SIDE_LABELS,
} from '../../types/brackets';
import './BracketLikeView.css';

interface BracketLikeViewProps {
  games: BracketGame[];
  initialSide?: BracketSide;
}

interface RoundData {
  roundNumber: number;
  roundName: string;
  games: BracketGame[];
}

function getStatusLabel(status: GameStatus): string {
  return GAME_STATUS_DISPLAY_LABELS[status];
}

function getTeamDisplayName(
  teamNumber?: number,
  teamName?: string,
  teamDisplay?: string | null,
): string {
  return teamName || teamDisplay || '';
}

export default function BracketLikeView({
  games,
  initialSide = 'winners',
}: BracketLikeViewProps) {
  const [selectedSide, setSelectedSide] = useState<BracketSide>(initialSide);
  const [isMobile, setIsMobile] = useState(false);
  const [selectedRoundIndex, setSelectedRoundIndex] = useState(0);

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Get available sides (only show sides that have games)
  const availableSides = useMemo(() => {
    const sides: BracketSide[] = [];
    if (games.some((g) => g.bracket_side === 'winners')) sides.push('winners');
    if (games.some((g) => g.bracket_side === 'losers')) sides.push('losers');
    if (games.some((g) => g.bracket_side === 'finals')) sides.push('finals');
    return sides;
  }, [games]);

  // Ensure selected side is valid
  useEffect(() => {
    if (availableSides.length > 0 && !availableSides.includes(selectedSide)) {
      setSelectedSide(availableSides[0]);
    }
  }, [availableSides, selectedSide]);

  // Filter and group games by round for the selected side
  const rounds = useMemo((): RoundData[] => {
    const sideGames = games.filter((g) => g.bracket_side === selectedSide);

    // Group by round_number
    const groupMap = new Map<number, BracketGame[]>();
    const roundNames = new Map<number, string>();

    for (const game of sideGames) {
      const roundNum = game.round_number ?? 0;
      if (!groupMap.has(roundNum)) {
        groupMap.set(roundNum, []);
      }
      groupMap.get(roundNum)!.push(game);

      if (game.round_name && !roundNames.has(roundNum)) {
        roundNames.set(roundNum, game.round_name);
      }
    }

    // Sort rounds and games within each round
    const sortedRounds = Array.from(groupMap.keys()).sort((a, b) => a - b);

    return sortedRounds.map((roundNum) => {
      const roundGames = groupMap.get(roundNum)!;
      roundGames.sort((a, b) => a.game_number - b.game_number);

      return {
        roundNumber: roundNum,
        roundName: roundNames.get(roundNum) || `Round ${roundNum}`,
        games: roundGames,
      };
    });
  }, [games, selectedSide]);

  // Reset selected round when side changes
  useEffect(() => {
    setSelectedRoundIndex(0);
  }, [selectedSide]);

  // Render a single match card
  const renderMatchCard = (
    game: BracketGame,
    isLastRound: boolean,
    matchIndex: number,
  ) => {
    const isTeam1Winner = game.winner_id === game.team1_id && game.winner_id;
    const isTeam2Winner = game.winner_id === game.team2_id && game.winner_id;
    const hasScores = game.team1_score !== null || game.team2_score !== null;
    const isCompleted = game.status === 'completed';

    return (
      <div
        key={game.id}
        className={`bracket-match ${isLastRound ? 'last-round' : ''}`}
        data-match-index={matchIndex}
      >
        {/* Status header */}
        <div className={`match-header match-status-${game.status}`}>
          {getStatusLabel(game.status)}
        </div>

        {/* Team 1 row */}
        <div
          className={`match-team-row ${isTeam1Winner ? 'winner' : ''} ${isCompleted && !isTeam1Winner ? 'loser' : ''} ${!game.team1_id ? 'tbd' : ''}`}
        >
          <span className="team-seed">
            {game.team1_number ? game.team1_number : ''}
          </span>
          <span className="team-name">
            {game.team1_id
              ? getTeamDisplayName(
                  game.team1_number,
                  game.team1_name,
                  game.team1_display,
                )
              : 'TBD'}
          </span>
          {hasScores && (
            <span className={`team-score ${isTeam1Winner ? 'winner' : ''}`}>
              {game.team1_score ?? '-'}
            </span>
          )}
          {isTeam1Winner && <span className="winner-indicator">◀</span>}
        </div>

        {/* Team 2 row */}
        <div
          className={`match-team-row ${isTeam2Winner ? 'winner' : ''} ${isCompleted && !isTeam2Winner ? 'loser' : ''} ${!game.team2_id ? 'tbd' : ''}`}
        >
          <span className="team-seed">
            {game.team2_number ? game.team2_number : ''}
          </span>
          <span className="team-name">
            {game.team2_id
              ? getTeamDisplayName(
                  game.team2_number,
                  game.team2_name,
                  game.team2_display,
                )
              : 'TBD'}
          </span>
          {hasScores && (
            <span className={`team-score ${isTeam2Winner ? 'winner' : ''}`}>
              {game.team2_score ?? '-'}
            </span>
          )}
          {isTeam2Winner && <span className="winner-indicator">◀</span>}
        </div>
      </div>
    );
  };

  if (games.length === 0) {
    return (
      <div className="bracket-like-view">
        <p className="no-games-message">
          No games available. Generate games to view the bracket.
        </p>
      </div>
    );
  }

  if (availableSides.length === 0) {
    return (
      <div className="bracket-like-view">
        <p className="no-games-message">No bracket data available.</p>
      </div>
    );
  }

  return (
    <div className="bracket-like-view">
      {/* Side toggle */}
      <div className="bracket-side-toggle">
        {availableSides.map((side) => (
          <button
            key={side}
            className={`side-toggle-btn ${selectedSide === side ? 'active' : ''}`}
            onClick={() => setSelectedSide(side)}
          >
            {BRACKET_SIDE_LABELS[side]}
          </button>
        ))}
      </div>

      {/* Mobile: Round chooser pills */}
      {isMobile && rounds.length > 0 && (
        <div className="round-chooser">
          {rounds.map((round, index) => (
            <button
              key={round.roundNumber}
              className={`round-pill ${selectedRoundIndex === index ? 'active' : ''}`}
              onClick={() => setSelectedRoundIndex(index)}
            >
              {round.roundName}
            </button>
          ))}
        </div>
      )}

      {/* Bracket content */}
      {isMobile ? (
        // Mobile: Single round view with vertical scroll
        <div className="bracket-mobile">
          {rounds.length > 0 && rounds[selectedRoundIndex] && (
            <div className="mobile-round">
              <h4 className="mobile-round-title">
                {rounds[selectedRoundIndex].roundName}
              </h4>
              <div className="mobile-matches">
                {rounds[selectedRoundIndex].games.map((game, idx) =>
                  renderMatchCard(game, true, idx),
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        // Desktop: Full bracket tree layout with grid positioning
        <div className="bracket-tree-container">
          <div
            className="bracket-tree"
            style={
              {
                '--total-rounds': rounds.length,
                '--first-round-matches': rounds[0]?.games.length || 1,
              } as React.CSSProperties
            }
          >
            {rounds.map((round, roundIndex) => {
              const isLastRound = roundIndex === rounds.length - 1;

              return (
                <div
                  key={round.roundNumber}
                  className={`bracket-round round-${roundIndex + 1}`}
                >
                  <div className="round-header">{round.roundName}</div>
                  <div className="round-matches-flex">
                    {round.games.map((game, matchIndex) => {
                      // Determine connector direction (even = down, odd = up)
                      const isEvenMatch = matchIndex % 2 === 0;

                      return (
                        <div
                          key={game.id}
                          className={`match-cell ${isLastRound ? 'last-round' : ''}`}
                        >
                          {renderMatchCard(game, isLastRound, matchIndex)}
                          {/* Connector lines (not on last round) */}
                          {!isLastRound && (
                            <div className="match-connector">
                              <div className="connector-h-out"></div>
                              <div
                                className={`connector-vertical ${isEvenMatch ? 'goes-down' : 'goes-up'}`}
                              ></div>
                              {isEvenMatch && (
                                <div className="connector-h-in"></div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
