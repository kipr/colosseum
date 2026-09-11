import { describe, expect, it } from 'vitest';
import {
  buildCreateMatrixRows,
  compareCreateMatrixRows,
  type BracketCreateMatrixRow,
} from '../../src/client/components/admin/brackets/buildCreateMatrix';

function row(
  partial: Partial<BracketCreateMatrixRow> & {
    team: BracketCreateMatrixRow['team'];
  },
): BracketCreateMatrixRow {
  return {
    ranking: undefined,
    doubleSeedingRanking: undefined,
    assigned: undefined,
    hasOverlap: false,
    ...partial,
  };
}

describe('buildCreateMatrixRows', () => {
  it('sorts by seed rank, then team number', () => {
    const rows = buildCreateMatrixRows({
      teams: [
        { id: 1, team_number: 20, team_name: 'B', display_name: null },
        { id: 2, team_number: 10, team_name: 'A', display_name: null },
        { id: 3, team_number: 15, team_name: 'C', display_name: null },
      ],
      rankings: [
        { team_id: 1, seed_average: 50, seed_rank: 2 },
        { team_id: 3, seed_average: 90, seed_rank: 1 },
      ],
      doubleSeedingRankings: [],
      assigned: [],
      selectedTeamIds: new Set(),
      doubleSeedingEnabled: false,
    });

    expect(rows.map((r) => r.team.id)).toEqual([3, 1, 2]);
  });

  it('marks selected assigned teams as overlapping', () => {
    const rows = buildCreateMatrixRows({
      teams: [{ id: 1, team_number: 1, team_name: 'A', display_name: null }],
      rankings: [],
      doubleSeedingRankings: [],
      assigned: [
        {
          team_id: 1,
          team_number: 1,
          team_name: 'A',
          bracket_id: 9,
          bracket_name: 'Main',
        },
      ],
      selectedTeamIds: new Set([1]),
      doubleSeedingEnabled: false,
    });

    expect(rows[0].hasOverlap).toBe(true);
  });

  it('sorts by combined seeding when double seeding is enabled', () => {
    const a = row({
      team: { id: 1, team_number: 1, team_name: 'A', display_name: null },
      ranking: { team_id: 1, seed_average: 10, seed_rank: 2 },
      doubleSeedingRanking: { team_id: 1, seed_average: 10, seed_rank: 2 },
    });
    const b = row({
      team: { id: 2, team_number: 2, team_name: 'B', display_name: null },
      ranking: { team_id: 2, seed_average: 40, seed_rank: 1 },
      doubleSeedingRanking: { team_id: 2, seed_average: 40, seed_rank: 1 },
    });
    expect(compareCreateMatrixRows(b, a, true)).toBeLessThan(0);
  });
});
