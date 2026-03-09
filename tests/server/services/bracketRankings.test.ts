import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { calculateBracketRankings } from '../../../src/server/services/bracketRankings';

describe('calculateBracketRankings', () => {
  let testDb: TestDb;
  let eventId: number;
  let bracketId: number;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    const event = await testDb.db.run(
      `INSERT INTO events (name, status) VALUES (?, ?)`,
      ['Bracket Test Event', 'active'],
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

  async function createBracket(size: number): Promise<number> {
    const result = await testDb.db.run(
      `INSERT INTO brackets (event_id, name, bracket_size, status) VALUES (?, ?, ?, ?)`,
      [eventId, 'Test Bracket', size, 'in_progress'],
    );
    return result.lastID!;
  }

  async function addEntry(
    bId: number,
    teamId: number,
    seedPosition: number,
  ): Promise<void> {
    await testDb.db.run(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye) VALUES (?, ?, ?, 0)`,
      [bId, teamId, seedPosition],
    );
  }

  async function addByeEntry(
    bId: number,
    seedPosition: number,
  ): Promise<void> {
    await testDb.db.run(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye) VALUES (?, NULL, ?, 1)`,
      [bId, seedPosition],
    );
  }

  async function addSeedingRank(
    teamId: number,
    seedRank: number,
  ): Promise<void> {
    await testDb.db.run(
      `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank) VALUES (?, ?, ?)`,
      [teamId, 100 - seedRank, seedRank],
    );
  }

  async function addCompletedGame(opts: {
    bracketId: number;
    gameNumber: number;
    bracketSide: string;
    roundNumber: number;
    winnerId: number;
    loserId: number;
  }): Promise<void> {
    await testDb.db.run(
      `INSERT INTO bracket_games (bracket_id, game_number, bracket_side, round_number, status, winner_id, loser_id, team1_id, team2_id)
       VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?)`,
      [
        opts.bracketId,
        opts.gameNumber,
        opts.bracketSide,
        opts.roundNumber,
        opts.winnerId,
        opts.loserId,
        opts.winnerId,
        opts.loserId,
      ],
    );
  }

  async function getRawScore(
    teamId: number,
  ): Promise<number | null | undefined> {
    const row = await testDb.db.get<{ bracket_raw_score: number | null }>(
      `SELECT bracket_raw_score FROM bracket_entries WHERE team_id = ?`,
      [teamId],
    );
    return row?.bracket_raw_score;
  }

  /**
   * Sets up a simple 4-team bracket with finals result and losers bracket.
   * Returns team IDs in order [1st, 2nd, 3rd, 4th].
   */
  async function setupFourTeamBracket(): Promise<number[]> {
    bracketId = await createBracket(4);

    const t1 = await createTeam(101);
    const t2 = await createTeam(102);
    const t3 = await createTeam(103);
    const t4 = await createTeam(104);

    await addEntry(bracketId, t1, 1);
    await addEntry(bracketId, t2, 2);
    await addEntry(bracketId, t3, 3);
    await addEntry(bracketId, t4, 4);

    await addSeedingRank(t1, 1);
    await addSeedingRank(t2, 2);
    await addSeedingRank(t3, 3);
    await addSeedingRank(t4, 4);

    // Losers bracket: t4 eliminated in round 1, t3 eliminated in round 2
    await addCompletedGame({
      bracketId,
      gameNumber: 1,
      bracketSide: 'losers',
      roundNumber: 1,
      winnerId: t3,
      loserId: t4,
    });
    await addCompletedGame({
      bracketId,
      gameNumber: 2,
      bracketSide: 'losers',
      roundNumber: 2,
      winnerId: t2,
      loserId: t3,
    });

    // Finals: t1 wins
    await addCompletedGame({
      bracketId,
      gameNumber: 3,
      bracketSide: 'finals',
      roundNumber: 3,
      winnerId: t1,
      loserId: t2,
    });

    return [t1, t2, t3, t4];
  }

  describe('bracket_raw_score formula', () => {
    it('computes (n - rank + 1) / n for each ranked team', async () => {
      const [t1, t2, t3, t4] = await setupFourTeamBracket();
      const result = await calculateBracketRankings(bracketId);

      expect(result.teamsRanked).toBe(4);

      // n = 4
      // 1st: (4 - 1 + 1) / 4 = 1.0
      expect(await getRawScore(t1)).toBeCloseTo(1.0, 5);
      // 2nd: (4 - 2 + 1) / 4 = 0.75
      expect(await getRawScore(t2)).toBeCloseTo(0.75, 5);
      // 3rd: (4 - 3 + 1) / 4 = 0.5
      expect(await getRawScore(t3)).toBeCloseTo(0.5, 5);
      // 4th: (4 - 4 + 1) / 4 = 0.25
      expect(await getRawScore(t4)).toBeCloseTo(0.25, 5);
    });

    it('gives tied teams identical raw scores', async () => {
      bracketId = await createBracket(4);

      const t1 = await createTeam(201);
      const t2 = await createTeam(202);
      const t3 = await createTeam(203);
      const t4 = await createTeam(204);

      await addEntry(bracketId, t1, 1);
      await addEntry(bracketId, t2, 2);
      await addEntry(bracketId, t3, 3);
      await addEntry(bracketId, t4, 4);

      await addSeedingRank(t1, 1);
      await addSeedingRank(t2, 2);
      await addSeedingRank(t3, 3);
      await addSeedingRank(t4, 4);

      // t3 and t4 both eliminated in losers round 1 (same round = tied rank)
      await addCompletedGame({
        bracketId,
        gameNumber: 1,
        bracketSide: 'losers',
        roundNumber: 1,
        winnerId: t1,
        loserId: t3,
      });
      await addCompletedGame({
        bracketId,
        gameNumber: 2,
        bracketSide: 'losers',
        roundNumber: 1,
        winnerId: t2,
        loserId: t4,
      });

      // Finals
      await addCompletedGame({
        bracketId,
        gameNumber: 3,
        bracketSide: 'finals',
        roundNumber: 2,
        winnerId: t1,
        loserId: t2,
      });

      await calculateBracketRankings(bracketId);

      // t3 and t4 share rank 3: (4 - 3 + 1) / 4 = 0.5
      expect(await getRawScore(t3)).toBeCloseTo(0.5, 5);
      expect(await getRawScore(t4)).toBeCloseTo(0.5, 5);
    });

    it('returns null raw score for unranked entries', async () => {
      bracketId = await createBracket(4);

      const t1 = await createTeam(301);
      const t2 = await createTeam(302);
      const t3 = await createTeam(303);

      await addEntry(bracketId, t1, 1);
      await addEntry(bracketId, t2, 2);
      await addEntry(bracketId, t3, 3);
      await addByeEntry(bracketId, 4);

      await addSeedingRank(t1, 1);
      await addSeedingRank(t2, 2);
      await addSeedingRank(t3, 3);

      // Only finals completed; t3 never appears in losers
      await addCompletedGame({
        bracketId,
        gameNumber: 1,
        bracketSide: 'finals',
        roundNumber: 1,
        winnerId: t1,
        loserId: t2,
      });

      await calculateBracketRankings(bracketId);

      // t1 and t2 ranked; t3 is not (no losers game result)
      expect(await getRawScore(t1)).not.toBeNull();
      expect(await getRawScore(t2)).not.toBeNull();
      expect(await getRawScore(t3)).toBeNull();
    });

    it('clears stale raw scores on recalculation', async () => {
      const [t1] = await setupFourTeamBracket();
      await calculateBracketRankings(bracketId);
      expect(await getRawScore(t1)).toBeCloseTo(1.0, 5);

      // Manually set a stale value on an entry that won't be ranked next time
      await testDb.db.run(
        `UPDATE bracket_entries SET bracket_raw_score = 0.9999 WHERE team_id = ?`,
        [t1],
      );

      // Recalculate — all values should be freshly computed, not stale
      await calculateBracketRankings(bracketId);
      expect(await getRawScore(t1)).toBeCloseTo(1.0, 5);
    });

    it('excludes bye entries from n', async () => {
      bracketId = await createBracket(4);

      const t1 = await createTeam(401);
      const t2 = await createTeam(402);
      const t3 = await createTeam(403);

      await addEntry(bracketId, t1, 1);
      await addEntry(bracketId, t2, 2);
      await addEntry(bracketId, t3, 3);
      await addByeEntry(bracketId, 4);

      await addSeedingRank(t1, 1);
      await addSeedingRank(t2, 2);
      await addSeedingRank(t3, 3);

      // Losers: t3 eliminated round 1
      await addCompletedGame({
        bracketId,
        gameNumber: 1,
        bracketSide: 'losers',
        roundNumber: 1,
        winnerId: t2,
        loserId: t3,
      });

      // Finals: t1 wins
      await addCompletedGame({
        bracketId,
        gameNumber: 2,
        bracketSide: 'finals',
        roundNumber: 2,
        winnerId: t1,
        loserId: t2,
      });

      await calculateBracketRankings(bracketId);

      // n = 3 (bye excluded)
      // 1st: (3 - 1 + 1) / 3 = 1.0
      expect(await getRawScore(t1)).toBeCloseTo(1.0, 5);
      // 2nd: (3 - 2 + 1) / 3 = 2/3
      expect(await getRawScore(t2)).toBeCloseTo(2 / 3, 5);
      // 3rd: (3 - 3 + 1) / 3 = 1/3
      expect(await getRawScore(t3)).toBeCloseTo(1 / 3, 5);
    });
  });
});
