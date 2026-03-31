import React from 'react';
import SeedingScoresTable, {
  buildTeamRowData,
  type Team,
  type SeedingScore,
  type SeedingRanking,
} from './SeedingScoresTable';

interface SeedingDisplayProps {
  teams: Team[];
  scores: SeedingScore[];
  rankings: SeedingRanking[];
  effectiveRounds: number;
}

export default function SeedingDisplay({
  teams,
  scores,
  rankings,
  effectiveRounds,
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
      />

      <div className="seeding-summary">
        {teams.length} team{teams.length !== 1 ? 's' : ''} •{' '}
        {rankings.filter((r) => r.seed_rank !== null).length} ranked
      </div>
    </>
  );
}
