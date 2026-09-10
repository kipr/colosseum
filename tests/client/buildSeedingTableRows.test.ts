import { describe, expect, it } from 'vitest';
import { buildSeedingTableRows } from '../../src/client/components/seedingScores';
import type { Team } from '../../src/client/components/seedingScores';

const teams: Team[] = [
  {
    id: 1,
    team_number: 101,
    team_name: 'Alpha',
    display_name: null,
  },
  {
    id: 2,
    team_number: 202,
    team_name: 'Beta',
    display_name: 'B',
  },
];

describe('buildSeedingTableRows', () => {
  it('maps per-round scores and leaves missing rounds null', () => {
    const rows = buildSeedingTableRows(
      teams,
      [
        { team_id: 1, round_number: 1, score: 42 },
        { team_id: 1, round_number: 3, score: 50 },
      ],
      [],
      3,
      () => null,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].scores.get(1)).toEqual({ score: 42 });
    expect(rows[0].scores.get(2)).toBeNull();
    expect(rows[0].scores.get(3)).toEqual({ score: 50 });
    expect(rows[1].scores.get(1)).toBeNull();
    expect(rows[1].ranking).toBeNull();
  });

  it('attaches ranking metrics using the raw-score getter', () => {
    const rows = buildSeedingTableRows(
      teams,
      [{ team_id: 1, round_number: 1, score: 10 }],
      [
        {
          team_id: 1,
          seed_rank: 2,
          seed_average: 12.5,
          raw_seed_score: 0.8123,
        },
        {
          team_id: 2,
          seed_rank: 1,
          seed_average: 20,
          raw_seed_score: 0.9,
        },
      ],
      1,
      (ranking) => ranking.raw_seed_score,
    );

    expect(rows[0].ranking).toEqual({
      seed_rank: 2,
      seed_average: 12.5,
      raw_score: 0.8123,
    });
    expect(rows[1].ranking).toEqual({
      seed_rank: 1,
      seed_average: 20,
      raw_score: 0.9,
    });
  });

  it('normalizes a different raw-score property via the getter', () => {
    const rows = buildSeedingTableRows(
      [teams[0]],
      [],
      [
        {
          team_id: 1,
          seed_rank: 1,
          seed_average: 8,
          raw_double_seed_score: 0.654321,
        },
      ],
      1,
      (ranking) => ranking.raw_double_seed_score,
    );

    expect(rows[0].ranking?.raw_score).toBe(0.654321);
  });
});
