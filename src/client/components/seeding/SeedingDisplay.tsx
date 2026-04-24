import React from 'react';
import SeedingScoresTable, { buildTeamRowData } from './SeedingScoresTable';
import type { Team } from '../../../shared/domain';
import type { SeedingScore, SeedingRanking } from '../../../shared/api';

interface SeedingDisplayProps {
  teams: readonly Team[];
  scores: readonly SeedingScore[];
  rankings: readonly SeedingRanking[];
  effectiveRounds: number;
  variant?: 'default' | 'spectator';
}

export default function SeedingDisplay({
  teams,
  scores,
  rankings,
  effectiveRounds,
  variant = 'default',
}: SeedingDisplayProps) {
  const teamRowData = buildTeamRowData(
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
      <SeedingScoresTable
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
