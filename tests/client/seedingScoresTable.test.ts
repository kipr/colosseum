import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import DoubleSeedingScoresTable, {
  buildDoubleSeedingTeamRowData,
  type DoubleSeedingRanking,
  type DoubleSeedingScore,
} from '../../src/client/components/doubleSeeding/DoubleSeedingScoresTable';
import SeedingScoresTable, {
  buildTeamRowData,
  type SeedingRanking,
  type SeedingScore,
  type Team,
} from '../../src/client/components/seeding/SeedingScoresTable';

const teams: Team[] = [
  {
    id: 1,
    team_number: 101,
    team_name: 'Alpha Robotics',
    display_name: null,
  },
  {
    id: 2,
    team_number: 202,
    team_name: 'Beta Bots',
    display_name: null,
  },
];

const seedingScores: SeedingScore[] = [
  {
    id: 10,
    team_id: 1,
    round_number: 1,
    score: 88,
    team_number: 101,
    team_name: 'Alpha Robotics',
    display_name: null,
  },
];

const seedingRankings: SeedingRanking[] = [
  {
    id: 20,
    team_id: 1,
    seed_average: 12.5,
    seed_rank: 3,
    raw_seed_score: 0.8123,
    tiebreaker_value: null,
    team_number: 101,
    team_name: 'Alpha Robotics',
    display_name: null,
  },
];

const doubleScores: DoubleSeedingScore[] = [
  {
    id: 11,
    event_id: 1,
    match_id: 5,
    team_id: 1,
    round_number: 1,
    side: 'team1',
    score: 77,
    match_number: 1,
    team_number: 101,
    team_name: 'Alpha Robotics',
    display_name: null,
  },
];

const doubleRankings: DoubleSeedingRanking[] = [
  {
    id: 21,
    team_id: 1,
    seed_average: 9.1,
    seed_rank: 2,
    raw_double_seed_score: 0.654321,
    tiebreaker_value: null,
    team_number: 101,
    team_name: 'Alpha Robotics',
    display_name: null,
  },
];

describe('SeedingScoresTable', () => {
  it('renders seeding copy, column labels, and formatted metrics', () => {
    const html = renderToStaticMarkup(
      React.createElement(SeedingScoresTable, {
        teamRowData: buildTeamRowData(teams, seedingScores, seedingRankings, 3),
        effectiveRounds: 3,
      }),
    );

    expect(html).toContain('Seeding scores and rankings');
    expect(html).toContain('top 2 of 3 scores');
    expect(html).toContain('75% rank position');
    expect(html).toContain('Seed Rank');
    expect(html).toContain('Seed Avg');
    expect(html).toContain('Raw Seed Score');
    expect(html).toContain('Sort by seed rank');
    expect(html).toContain('Sort by seed average');
    expect(html).toContain('Sort by raw seed score');
    expect(html).toContain('88');
    expect(html).toContain('12.50');
    expect(html).toContain('0.8123');
    expect(html).toContain('—');
    expect(html).not.toContain('Double seeding scores and rankings');
    expect(html).not.toContain('Raw Double Seed Score');
  });
});

describe('DoubleSeedingScoresTable', () => {
  it('renders double-seeding copy, column labels, and formatted metrics', () => {
    const html = renderToStaticMarkup(
      React.createElement(DoubleSeedingScoresTable, {
        teamRowData: buildDoubleSeedingTeamRowData(
          teams,
          doubleScores,
          doubleRankings,
          2,
        ),
        effectiveRounds: 2,
      }),
    );

    expect(html).toContain('Double seeding scores and rankings');
    expect(html).toContain('no rounds dropped');
    expect(html).toContain('2/3 rank position');
    expect(html).toContain('Double Seeding Rank');
    expect(html).toContain('Double Seeding Average');
    expect(html).toContain('Raw Double Seed Score');
    expect(html).toContain('Sort by double-seeding rank');
    expect(html).toContain('Sort by double-seeding average');
    expect(html).toContain('Sort by raw double seed score');
    expect(html).toContain('Average');
    expect(html).toContain('77');
    expect(html).toContain('9.10');
    expect(html).toContain('0.6543');
    expect(html).not.toContain('Seeding scores and rankings');
    expect(html).not.toContain('Raw Seed Score');
    expect(html).not.toContain('Seed Avg');
  });
});
