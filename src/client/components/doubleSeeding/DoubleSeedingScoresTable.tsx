import {
  SeedingScoresTableBase,
  buildSeedingTableRows,
  type SeedingTableCopy,
  type SeedingTableRow,
  type SeedingTableVariant,
  type Team,
} from '../seedingScores';
import type {
  DoubleSeedingRanking,
  DoubleSeedingScore,
} from '../../api/doubleSeeding';

export type { Team, DoubleSeedingScore, DoubleSeedingRanking };

export type DoubleSeedingTeamRowData = SeedingTableRow;

export function buildDoubleSeedingTeamRowData(
  teams: Team[],
  scores: DoubleSeedingScore[],
  rankings: DoubleSeedingRanking[],
  effectiveRounds: number,
): DoubleSeedingTeamRowData[] {
  return buildSeedingTableRows(
    teams,
    scores,
    rankings,
    effectiveRounds,
    (ranking) => ranking.raw_double_seed_score,
  );
}

const DOUBLE_SEEDING_TABLE_COPY: SeedingTableCopy = {
  title: 'Double seeding scores and rankings',
  description: (
    <>
      Each team&apos;s own side score per round. Rankings use the average of all
      rounds (no rounds dropped). Raw double seed score: 2/3 rank position + 1/3
      score ratio against the event&apos;s best single round.
    </>
  ),
  rank: {
    full: 'Rank',
    short: 'Rank',
    title: 'Double Seeding Rank',
    sortAriaLabel: 'Sort by double-seeding rank',
  },
  average: {
    full: 'Average',
    short: 'Avg',
    title: 'Double Seeding Average',
    sortAriaLabel: 'Sort by double-seeding average',
  },
  raw: {
    full: 'Raw Double Seed Score',
    short: 'Raw',
    title: 'Raw Double Seed Score',
    sortAriaLabel: 'Sort by raw double seed score',
  },
};

interface DoubleSeedingScoresTableProps {
  teamRowData: DoubleSeedingTeamRowData[];
  effectiveRounds: number;
  variant?: SeedingTableVariant;
}

export default function DoubleSeedingScoresTable({
  teamRowData,
  effectiveRounds,
  variant = 'default',
}: DoubleSeedingScoresTableProps) {
  return (
    <SeedingScoresTableBase
      teamRowData={teamRowData}
      effectiveRounds={effectiveRounds}
      variant={variant}
      copy={DOUBLE_SEEDING_TABLE_COPY}
    />
  );
}
