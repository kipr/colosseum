import {
  SeedingScoresTableBase,
  buildSeedingTableRows,
  type SeedingTableCopy,
  type SeedingTableRow,
  type SeedingTableVariant,
  type Team,
} from '../seedingScores';
import type { SeedingRanking, SeedingScore } from '../../api/seeding';

export type { Team, SeedingScore, SeedingRanking };

export type TeamRowData = SeedingTableRow;

export function buildTeamRowData(
  teams: Team[],
  scores: SeedingScore[],
  rankings: SeedingRanking[],
  effectiveRounds: number,
): TeamRowData[] {
  return buildSeedingTableRows(
    teams,
    scores,
    rankings,
    effectiveRounds,
    (ranking) => ranking.raw_seed_score,
  );
}

const SEEDING_TABLE_COPY: SeedingTableCopy = {
  title: 'Seeding scores and rankings',
  description: (
    <>
      Per-round scores and final seed metrics. Rankings use seed averages (e.g.
      top 2 of 3 scores). Raw seed score: 75% rank position + 25% score ratio
      against the event&apos;s best single round.
    </>
  ),
  rank: {
    full: 'Seed Rank',
    short: 'Rank',
    title: 'Seed Rank',
    sortAriaLabel: 'Sort by seed rank',
  },
  average: {
    full: 'Seed Avg',
    short: 'Avg',
    title: 'Seed Average',
    sortAriaLabel: 'Sort by seed average',
  },
  raw: {
    full: 'Raw Seed Score',
    short: 'Raw',
    title: 'Raw Seed Score',
    sortAriaLabel: 'Sort by raw seed score',
  },
};

interface SeedingScoresTableProps {
  teamRowData: TeamRowData[];
  effectiveRounds: number;
  variant?: SeedingTableVariant;
}

export default function SeedingScoresTable({
  teamRowData,
  effectiveRounds,
  variant = 'default',
}: SeedingScoresTableProps) {
  return (
    <SeedingScoresTableBase
      teamRowData={teamRowData}
      effectiveRounds={effectiveRounds}
      variant={variant}
      copy={SEEDING_TABLE_COPY}
    />
  );
}
