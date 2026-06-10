/**
 * Tests for double-seeding ranking recalculation.
 *
 * Raw double seed score: (2/3)*((n-rank+1)/n) + (1/3)*(avg/max)
 * where n = number of teams at the event and max = max tournament average.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { recalculateDoubleSeedingRankings } from '../../../src/server/services/doubleSeedingRankings';
import {
  seedEvent,
  seedTeam,
  seedDoubleSeedingMatch,
  seedDoubleSeedingScore,
} from '../../http/helpers/seed';

describe('recalculateDoubleSeedingRankings', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  async function addScore(
    eventId: number,
    teamId: number,
    round: number,
    score: number | null,
  ) {
    const match = await seedDoubleSeedingMatch(testDb.db, {
      event_id: eventId,
      round_number: round,
      team1_id: teamId,
      status: 'completed',
    });
    await seedDoubleSeedingScore(testDb.db, {
      event_id: eventId,
      match_id: match.id,
      team_id: teamId,
      round_number: round,
      side: 'team1',
      score,
    });
  }

  it('averages all rounds (no rounds dropped, zeros count, missing ignored)', async () => {
    const event = await seedEvent(testDb.db);
    const teamA = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    const teamB = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 2,
    });

    // Team A: 100, 0, 50 -> avg 50 (zero counts)
    await addScore(event.id, teamA.id, 1, 100);
    await addScore(event.id, teamA.id, 2, 0);
    await addScore(event.id, teamA.id, 3, 50);

    // Team B: 90 (missing rounds ignored) -> avg 90
    await addScore(event.id, teamB.id, 1, 90);

    const result = await recalculateDoubleSeedingRankings(event.id);
    expect(result.teamsRanked).toBe(2);

    const rankings = await testDb.db.all(
      `SELECT * FROM double_seeding_rankings ORDER BY seed_rank ASC`,
    );
    expect(rankings.length).toBe(2);

    const first = rankings[0];
    const second = rankings[1];
    expect(first.team_id).toBe(teamB.id);
    expect(first.seed_average).toBeCloseTo(90);
    expect(second.team_id).toBe(teamA.id);
    expect(second.seed_average).toBeCloseTo(50);

    // n = 2 teams at event; max average = 90
    expect(first.raw_double_seed_score).toBeCloseTo(
      (2 / 3) * ((2 - 1 + 1) / 2) + (1 / 3) * (90 / 90),
    );
    expect(second.raw_double_seed_score).toBeCloseTo(
      (2 / 3) * ((2 - 2 + 1) / 2) + (1 / 3) * (50 / 90),
    );
  });

  it('uses n = number of teams at event (including unranked teams)', async () => {
    const event = await seedEvent(testDb.db);
    const teamA = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    // Two teams with no scores still count towards n
    await seedTeam(testDb.db, { event_id: event.id, team_number: 2 });
    await seedTeam(testDb.db, { event_id: event.id, team_number: 3 });

    await addScore(event.id, teamA.id, 1, 60);

    const result = await recalculateDoubleSeedingRankings(event.id);
    expect(result.teamsRanked).toBe(1);
    expect(result.teamsUnranked).toBe(2);

    const ranking = await testDb.db.get(
      'SELECT * FROM double_seeding_rankings WHERE team_id = ?',
      [teamA.id],
    );
    // n = 3, rank 1, avg = max -> (2/3)*(3/3) + (1/3)*1 = 1
    expect(ranking?.raw_double_seed_score).toBeCloseTo(1);
  });

  it('breaks ties between equal averages using the lowest score (higher wins)', async () => {
    const event = await seedEvent(testDb.db);
    const teamA = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    const teamB = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 2,
    });

    // Both average 50; A's lowest = 40, B's lowest = 20
    await addScore(event.id, teamA.id, 1, 40);
    await addScore(event.id, teamA.id, 2, 60);
    await addScore(event.id, teamB.id, 1, 20);
    await addScore(event.id, teamB.id, 2, 80);

    await recalculateDoubleSeedingRankings(event.id);

    const rankA = await testDb.db.get(
      'SELECT seed_rank, tiebreaker_value FROM double_seeding_rankings WHERE team_id = ?',
      [teamA.id],
    );
    const rankB = await testDb.db.get(
      'SELECT seed_rank, tiebreaker_value FROM double_seeding_rankings WHERE team_id = ?',
      [teamB.id],
    );
    expect(rankA?.seed_rank).toBe(1);
    expect(rankA?.tiebreaker_value).toBe(40);
    expect(rankB?.seed_rank).toBe(2);
    expect(rankB?.tiebreaker_value).toBe(20);
  });

  it('leaves teams with no scores unranked and is independent of ordinary seeding', async () => {
    const event = await seedEvent(testDb.db);
    const teamA = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    const teamB = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 2,
    });

    // Ordinary seeding score exists, but should not affect double-seeding rankings
    await testDb.db.run(
      'INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, ?, ?)',
      [teamB.id, 1, 999],
    );

    await addScore(event.id, teamA.id, 1, 10);

    await recalculateDoubleSeedingRankings(event.id);

    const rankA = await testDb.db.get(
      'SELECT seed_rank FROM double_seeding_rankings WHERE team_id = ?',
      [teamA.id],
    );
    const rankB = await testDb.db.get(
      'SELECT seed_rank, seed_average FROM double_seeding_rankings WHERE team_id = ?',
      [teamB.id],
    );
    expect(rankA?.seed_rank).toBe(1);
    expect(rankB?.seed_rank).toBeNull();
    expect(rankB?.seed_average).toBeNull();
  });
});
