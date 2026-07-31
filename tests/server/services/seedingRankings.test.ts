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

  it('gives raw seed score of 1.0 when the leader is perfectly consistent', async () => {
    const teamA = await createTeam(1);
    const teamB = await createTeam(2);

    // Team A: 100, 100 -> avg 100, max single round 100
    await addScore(teamA, 1, 100);
    await addScore(teamA, 2, 100);
    await addScore(teamB, 1, 80);
    await addScore(teamB, 2, 70);

    await recalculateSeedingRankings(eventId);

    const ranking = await testDb.db.get<{ raw_seed_score: number }>(
      `SELECT raw_seed_score FROM seeding_rankings WHERE team_id = ?`,
      [teamA],
    );
    // n = 2, rank 1: (3/4)*1 + (1/4)*(100/100) = 1.0
    expect(ranking?.raw_seed_score).toBeCloseTo(1.0, 5);
  });

  it('gives the inconsistent leader a raw seed score below 1.0', async () => {
    const teamA = await createTeam(1);
    const teamB = await createTeam(2);

    // Team A: 120, 80 -> avg 100, max single round 120
    await addScore(teamA, 1, 120);
    await addScore(teamA, 2, 80);
    await addScore(teamB, 1, 90);
    await addScore(teamB, 2, 70);

    await recalculateSeedingRankings(eventId);

    const ranking = await testDb.db.get<{ raw_seed_score: number }>(
      `SELECT raw_seed_score FROM seeding_rankings WHERE team_id = ?`,
      [teamA],
    );
    // n = 2, rank 1: (3/4)*1 + (1/4)*(100/120) = 0.75 + 0.208333... ≈ 0.958333
    expect(ranking?.raw_seed_score).toBeCloseTo(0.958333, 4);
    expect(ranking!.raw_seed_score).toBeLessThan(1);
  });

  it('keeps the legacy maxAverage denominator for events created before the cutoff', async () => {
    await testDb.db.run(
      `UPDATE events SET created_at = '2020-01-01 00:00:00' WHERE id = ?`,
      [eventId],
    );

    const teamA = await createTeam(1);
    const teamB = await createTeam(2);

    // Same inconsistent scores as above; legacy formula uses maxAverage = 100
    await addScore(teamA, 1, 120);
    await addScore(teamA, 2, 80);
    await addScore(teamB, 1, 90);
    await addScore(teamB, 2, 70);

    await recalculateSeedingRankings(eventId);

    const ranking = await testDb.db.get<{ raw_seed_score: number }>(
      `SELECT raw_seed_score FROM seeding_rankings WHERE team_id = ?`,
      [teamA],
    );
    // Legacy: (3/4)*1 + (1/4)*(100/100) = 1.0
    expect(ranking?.raw_seed_score).toBeCloseTo(1.0, 5);
  });
});
