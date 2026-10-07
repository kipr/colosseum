import SeedingScoresTable, {
  buildTeamRowData,
  type RoundScore,
  type RankingBase,
  type SeedingTableConfig,
} from './SeedingScoresTable';
import type { TeamSummary } from '../../types/teams';

interface SeedingDisplayProps<S extends RoundScore, R extends RankingBase> {
  teams: TeamSummary[];
  scores: S[];
  rankings: R[];
  effectiveRounds: number;
  config: SeedingTableConfig<R>;
  variant?: 'default' | 'spectator';
}

export default function SeedingDisplay<
  S extends RoundScore,
  R extends RankingBase,
>({
  teams,
  scores,
  rankings,
  effectiveRounds,
  config,
  variant = 'default',
}: SeedingDisplayProps<S, R>) {
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
        config={config}
        variant={variant}
      />

      <div className="seeding-summary">
        {teams.length} team{teams.length !== 1 ? 's' : ''} •{' '}
        {rankings.filter((r) => r.seed_rank !== null).length} ranked
      </div>
    </>
  );
}
