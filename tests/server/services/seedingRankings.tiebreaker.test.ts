import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { recalculateSeedingRankings } from '../../../src/server/services/seedingRankings';

describe('recalculateSeedingRankings – tiebreaker branches', () => {
  let testDb: TestDb;
  let eventId: number;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    const event = await testDb.db.run(
      `INSERT INTO events (name, status, seeding_rounds) VALUES (?, ?, ?)`,
      ['Tiebreaker Event', 'setup', 3],
    );
    eventId = event.lastID!;
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  async function createTeam(teamNumber: number): Promise<number> {
    const result = await testDb.db.run(
      `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
      [eventId, teamNumber, `Team ${teamNumber}`],
    );
    return result.lastID!;
  }

  async function addScore(teamId: number, roundNumber: number, score: number) {
    await testDb.db.run(
      `INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, ?, ?)`,
      [teamId, roundNumber, score],
    );
  }

  it('breaks ties using tiebreaker when seed averages are equal', async () => {
    const teamA = await createTeam(1);
    const teamB = await createTeam(2);

    // Both teams have identical top-2 average (100) but different 3rd scores
    await addScore(teamA, 1, 100);
    await addScore(teamA, 2, 100);
    await addScore(teamA, 3, 50);

    await addScore(teamB, 1, 100);
    await addScore(teamB, 2, 100);
    await addScore(teamB, 3, 80);

    const result = await recalculateSeedingRankings(eventId);
    expect(result).toEqual({ teamsRanked: 2, teamsUnranked: 0 });

    const rankA = await testDb.db.get<{ seed_rank: number }>(
      `SELECT seed_rank FROM seeding_rankings WHERE team_id = ?`,
      [teamA],
    );
    const rankB = await testDb.db.get<{ seed_rank: number }>(
      `SELECT seed_rank FROM seeding_rankings WHERE team_id = ?`,
      [teamB],
    );

    // Team B has higher tiebreaker (80 > 50), so should rank first
    expect(rankB?.seed_rank).toBe(1);
    expect(rankA?.seed_rank).toBe(2);
  });

  it('handles multiple teams with mixed scored and unscored', async () => {
    const teamA = await createTeam(10);
    const teamB = await createTeam(20);
    const teamC = await createTeam(30);
    const teamD = await createTeam(40);

    // Teams A and B: equal average, tiebreaker decides
    await addScore(teamA, 1, 90);
    await addScore(teamA, 2, 90);
    await addScore(teamA, 3, 70);

    await addScore(teamB, 1, 90);
    await addScore(teamB, 2, 90);
    await addScore(teamB, 3, 60);

    // Team C: higher average
    await addScore(teamC, 1, 120);
    await addScore(teamC, 2, 100);

    // Team D: no scores at all (unranked)

    const result = await recalculateSeedingRankings(eventId);
    expect(result).toEqual({ teamsRanked: 3, teamsUnranked: 1 });

    const rankA = await testDb.db.get<{ seed_rank: number | null }>(
      `SELECT seed_rank FROM seeding_rankings WHERE team_id = ?`,
      [teamA],
    );
    const rankB = await testDb.db.get<{ seed_rank: number | null }>(
      `SELECT seed_rank FROM seeding_rankings WHERE team_id = ?`,
      [teamB],
    );
    const rankC = await testDb.db.get<{ seed_rank: number | null }>(
      `SELECT seed_rank FROM seeding_rankings WHERE team_id = ?`,
      [teamC],
    );
    const rankD = await testDb.db.get<{ seed_rank: number | null }>(
      `SELECT seed_rank FROM seeding_rankings WHERE team_id = ?`,
      [teamD],
    );

    expect(rankC?.seed_rank).toBe(1);
    expect(rankA?.seed_rank).toBe(2);
    expect(rankB?.seed_rank).toBe(3);
    expect(rankD?.seed_rank).toBeNull();
  });

  it('handles single-score teams with equal averages', async () => {
    const teamA = await createTeam(1);
    const teamB = await createTeam(2);

    // Both teams have 1 score each, equal average, tiebreaker = score itself
    await addScore(teamA, 1, 75);
    await addScore(teamB, 1, 75);

    const result = await recalculateSeedingRankings(eventId);
    expect(result).toEqual({ teamsRanked: 2, teamsUnranked: 0 });

    // Both have same average and tiebreaker, so rank order is stable
    const ranks = await testDb.db.all<{ team_id: number; seed_rank: number }>(
      `SELECT team_id, seed_rank FROM seeding_rankings ORDER BY seed_rank ASC`,
    );
    expect(ranks.length).toBe(2);
    expect(ranks[0].seed_rank).toBe(1);
    expect(ranks[1].seed_rank).toBe(2);
  });
});
