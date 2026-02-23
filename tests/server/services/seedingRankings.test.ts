import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { recalculateSeedingRankings } from '../../../src/server/services/seedingRankings';

describe('recalculateSeedingRankings', () => {
  let testDb: TestDb;
  let eventId: number;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    const event = await testDb.db.run(
      `INSERT INTO events (name, status, seeding_rounds) VALUES (?, ?, ?)`,
      ['Service Test Event', 'setup', 3],
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

  it('returns zero counts when event has no teams', async () => {
    const result = await recalculateSeedingRankings(eventId);
    expect(result).toEqual({ teamsRanked: 0, teamsUnranked: 0 });
  });

  it('returns ranked/unranked counts and writes expected ranks', async () => {
    const teamA = await createTeam(100);
    const teamB = await createTeam(200);
    const teamC = await createTeam(300);

    await addScore(teamA, 1, 100);
    await addScore(teamA, 2, 90);
    await addScore(teamB, 1, 120);
    await addScore(teamB, 2, 110);
    // teamC intentionally has no score

    const result = await recalculateSeedingRankings(eventId);
    expect(result).toEqual({ teamsRanked: 2, teamsUnranked: 1 });

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

    expect(rankB?.seed_rank).toBe(1);
    expect(rankA?.seed_rank).toBe(2);
    expect(rankC?.seed_rank).toBeNull();
  });

  it('updates existing rankings when scores change and recalculation reruns', async () => {
    const teamA = await createTeam(10);
    const teamB = await createTeam(20);

    await addScore(teamA, 1, 100);
    await addScore(teamB, 1, 90);
    await recalculateSeedingRankings(eventId);

    await addScore(teamB, 2, 160);
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
    const totalRows = await testDb.db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM seeding_rankings`,
    );

    expect(rankB?.seed_rank).toBe(1);
    expect(rankA?.seed_rank).toBe(2);
    expect(totalRows?.count).toBe(2);
  });
});
