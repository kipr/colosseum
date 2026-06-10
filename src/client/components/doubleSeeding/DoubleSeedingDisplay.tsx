import React from 'react';
import type { Team } from '../seeding/SeedingScoresTable';
import DoubleSeedingScoresTable, {
  buildDoubleSeedingTeamRowData,
  type DoubleSeedingScore,
  type DoubleSeedingRanking,
} from './DoubleSeedingScoresTable';

interface DoubleSeedingDisplayProps {
  teams: Team[];
  scores: DoubleSeedingScore[];
  rankings: DoubleSeedingRanking[];
  effectiveRounds: number;
  variant?: 'default' | 'spectator';
}

export default function DoubleSeedingDisplay({
  teams,
  scores,
  rankings,
  effectiveRounds,
  variant = 'default',
}: DoubleSeedingDisplayProps) {
  const teamRowData = buildDoubleSeedingTeamRowData(
    teams,
    scores,
    rankings,
    effectiveRounds,
  );

  if (teams.length === 0) {
    return (
      <div className="card">
        <p style={{ color: 'var(--secondary-color)' }}>
          No teams found for this event.
        </p>
      </div>
    );
  }

  return (
    <>
      <DoubleSeedingScoresTable
        teamRowData={teamRowData}
        effectiveRounds={effectiveRounds}
        variant={variant}
      />

      <div className="seeding-summary">
        {teams.length} team{teams.length !== 1 ? 's' : ''} •{' '}
        {rankings.filter((r) => r.seed_rank !== null).length} ranked
      </div>
    </>
  );
}
