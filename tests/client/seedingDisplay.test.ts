import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SeedingDisplay from '../../src/client/components/seeding/SeedingDisplay';
import {
  DOUBLE_SEEDING_TABLE_CONFIG,
  SEEDING_TABLE_CONFIG,
  type DoubleSeedingRanking,
  type DoubleSeedingScore,
  type SeedingRanking,
  type SeedingScore,
} from '../../src/client/components/seeding/SeedingScoresTable';
import type { TeamSummary } from '../../src/client/types/teams';

const teams: TeamSummary[] = [
  { id: 1, team_number: 101, team_name: 'Alpha', display_name: null },
  { id: 2, team_number: 102, team_name: 'Beta', display_name: null },
];

const teamFields = { team_number: 101, team_name: 'Alpha', display_name: null };

const seedingScores: SeedingScore[] = [
  { id: 1, team_id: 1, round_number: 1, score: 50, ...teamFields },
];

const seedingRankings: SeedingRanking[] = [
  {
    id: 1,
    team_id: 1,
    seed_average: 50,
    seed_rank: 1,
    raw_seed_score: 0.71234,
    tiebreaker_value: null,
    ...teamFields,
  },
];

const doubleSeedingScores: DoubleSeedingScore[] = [
  {
    id: 1,
    event_id: 1,
    match_id: 1,
    team_id: 1,
    round_number: 1,
    side: 'team1',
    score: 40,
    match_number: 1,
    ...teamFields,
  },
];

const doubleSeedingRankings: DoubleSeedingRanking[] = [
  {
    id: 1,
    team_id: 1,
    seed_average: 40,
    seed_rank: 1,
    raw_double_seed_score: 0.45678,
    tiebreaker_value: null,
    ...teamFields,
  },
];

describe('SeedingDisplay', () => {
  it('renders the seeding table from raw_seed_score', () => {
    const html = renderToStaticMarkup(
      React.createElement(SeedingDisplay<SeedingScore, SeedingRanking>, {
        teams,
        scores: seedingScores,
        rankings: seedingRankings,
        effectiveRounds: 1,
        config: SEEDING_TABLE_CONFIG,
      }),
    );

    expect(html).toContain('Seeding scores and rankings');
    expect(html).not.toContain('Double seeding');
    expect(html).toContain('Seed Rank');
    expect(html).toContain('Seed Avg');
    expect(html).toContain('Raw Seed Score');
    expect(html).toContain('0.7123');
    expect(html).toContain('2 teams • 1 ranked');
  });

  it('renders the double-seeding table from raw_double_seed_score', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        SeedingDisplay<DoubleSeedingScore, DoubleSeedingRanking>,
        {
          teams,
          scores: doubleSeedingScores,
          rankings: doubleSeedingRankings,
          effectiveRounds: 1,
          config: DOUBLE_SEEDING_TABLE_CONFIG,
          variant: 'spectator',
        },
      ),
    );

    expect(html).toContain('Double seeding scores and rankings');
    expect(html).toContain('Double Seeding Rank');
    expect(html).toContain('Double Seeding Average');
    expect(html).toContain('Raw Double Seed Score');
    expect(html).not.toContain('Seed Avg');
    expect(html).toContain('0.4568');
    expect(html).toContain('2 teams • 1 ranked');
  });
});
