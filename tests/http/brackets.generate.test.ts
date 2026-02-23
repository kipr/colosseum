/**
 * HTTP route tests for bracket entry/game generation endpoints.
 * Targets POST /brackets/:id/entries/generate and POST /brackets/:id/games/generate.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../src/server/database/connection';
import {
  createTestApp,
  startServer,
  TestServerHandle,
  http,
} from './helpers/testServer';
import {
  seedEvent,
  seedUser,
  seedTeam,
  seedBracket,
  seedSeedingScore,
} from './helpers/seed';
import bracketsRoutes from '../../src/server/routes/brackets';
import { recalculateSeedingRankings } from '../../src/server/services/seedingRankings';

describe('Brackets Entry & Game Generation', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
    const user = await seedUser(testDb.db);
    const app = createTestApp({ user: { id: user.id, is_admin: false } });
    app.use('/brackets', bracketsRoutes);
    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  // ==========================================================================
  // POST /brackets/:id/entries/generate
  // ==========================================================================

  describe('POST /brackets/:id/entries/generate', () => {
    it('generates entries from seeding rankings', async () => {
      const event = await seedEvent(testDb.db);
      const teams = [];
      for (let i = 1; i <= 5; i++) {
        const t = await seedTeam(testDb.db, {
          event_id: event.id,
          team_number: i,
        });
        await seedSeedingScore(testDb.db, {
          team_id: t.id,
          round_number: 1,
          score: 100 * (6 - i),
        });
        await seedSeedingScore(testDb.db, {
          team_id: t.id,
          round_number: 2,
          score: 90 * (6 - i),
        });
        teams.push(t);
      }
      await recalculateSeedingRankings(event.id);

      const bracket = await seedBracket(testDb.db, {
        event_id: event.id,
        bracket_size: 8,
      });

      const res = await http.post(
        `${baseUrl}/brackets/${bracket.id}/entries/generate`,
      );
      expect(res.status).toBe(200);
      const body = res.json as {
        entriesCreated: number;
        byeCount: number;
        totalEntries: number;
        actualTeamCount: number;
      };
      expect(body.entriesCreated).toBe(5);
      expect(body.byeCount).toBe(3);
      expect(body.totalEntries).toBe(8);
      expect(body.actualTeamCount).toBe(5);
    });

    it('returns 404 when bracket not found', async () => {
      const res = await http.post(
        `${baseUrl}/brackets/9999/entries/generate`,
      );
      expect(res.status).toBe(404);
    });

    it('returns 409 when entries already exist without force', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      await seedSeedingScore(testDb.db, {
        team_id: team.id,
        round_number: 1,
        score: 100,
      });
      await seedSeedingScore(testDb.db, {
        team_id: team.id,
        round_number: 2,
        score: 90,
      });
      await recalculateSeedingRankings(event.id);

      const bracket = await seedBracket(testDb.db, {
        event_id: event.id,
        bracket_size: 4,
      });

      // First generation
      await http.post(`${baseUrl}/brackets/${bracket.id}/entries/generate`);

      // Second attempt without force
      const res = await http.post(
        `${baseUrl}/brackets/${bracket.id}/entries/generate`,
      );
      expect(res.status).toBe(409);
      expect((res.json as { error: string }).error).toContain('already has entries');
    });

    it('replaces entries when force=true', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      await seedSeedingScore(testDb.db, {
        team_id: team.id,
        round_number: 1,
        score: 100,
      });
      await seedSeedingScore(testDb.db, {
        team_id: team.id,
        round_number: 2,
        score: 90,
      });
      await recalculateSeedingRankings(event.id);

      const bracket = await seedBracket(testDb.db, {
        event_id: event.id,
        bracket_size: 4,
      });

      // First generation
      await http.post(`${baseUrl}/brackets/${bracket.id}/entries/generate`);

      // Replace with force
      const res = await http.post(
        `${baseUrl}/brackets/${bracket.id}/entries/generate?force=true`,
      );
      expect(res.status).toBe(200);
      expect((res.json as { entriesCreated: number }).entriesCreated).toBe(1);
    });

    it('returns 400 when no ranked teams exist', async () => {
      const event = await seedEvent(testDb.db);
      await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });

      const bracket = await seedBracket(testDb.db, {
        event_id: event.id,
        bracket_size: 4,
      });

      const res = await http.post(
        `${baseUrl}/brackets/${bracket.id}/entries/generate`,
      );
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('No ranked teams');
    });
  });

  // ==========================================================================
  // POST /brackets/:id/games/generate
  // ==========================================================================

  describe('POST /brackets/:id/games/generate', () => {
    it('generates games from bracket templates', async () => {
      const event = await seedEvent(testDb.db);
      const teams = [];
      for (let i = 1; i <= 4; i++) {
        const t = await seedTeam(testDb.db, {
          event_id: event.id,
          team_number: i,
        });
        await seedSeedingScore(testDb.db, {
          team_id: t.id,
          round_number: 1,
          score: 100 * (5 - i),
        });
        await seedSeedingScore(testDb.db, {
          team_id: t.id,
          round_number: 2,
          score: 90 * (5 - i),
        });
        teams.push(t);
      }
      await recalculateSeedingRankings(event.id);

      const bracket = await seedBracket(testDb.db, {
        event_id: event.id,
        bracket_size: 4,
      });

      // Generate entries first
      await http.post(`${baseUrl}/brackets/${bracket.id}/entries/generate`);

      // Generate games
      const res = await http.post(
        `${baseUrl}/brackets/${bracket.id}/games/generate`,
      );
      expect(res.status).toBe(200);
      const body = res.json as { gamesCreated: number };
      expect(body.gamesCreated).toBeGreaterThan(0);

      const games = await testDb.db.all(
        'SELECT * FROM bracket_games WHERE bracket_id = ?',
        [bracket.id],
      );
      expect(games.length).toBeGreaterThan(0);
    });

    it('returns 404 when bracket not found', async () => {
      const res = await http.post(
        `${baseUrl}/brackets/9999/games/generate`,
      );
      expect(res.status).toBe(404);
    });

    it('returns 409 when games already exist without force', async () => {
      const event = await seedEvent(testDb.db);
      const teams = [];
      for (let i = 1; i <= 4; i++) {
        const t = await seedTeam(testDb.db, {
          event_id: event.id,
          team_number: i,
        });
        await seedSeedingScore(testDb.db, {
          team_id: t.id,
          round_number: 1,
          score: 100 * (5 - i),
        });
        await seedSeedingScore(testDb.db, {
          team_id: t.id,
          round_number: 2,
          score: 90 * (5 - i),
        });
        teams.push(t);
      }
      await recalculateSeedingRankings(event.id);

      const bracket = await seedBracket(testDb.db, {
        event_id: event.id,
        bracket_size: 4,
      });

      await http.post(`${baseUrl}/brackets/${bracket.id}/entries/generate`);
      await http.post(`${baseUrl}/brackets/${bracket.id}/games/generate`);

      const res = await http.post(
        `${baseUrl}/brackets/${bracket.id}/games/generate`,
      );
      expect(res.status).toBe(409);
      expect((res.json as { error: string }).error).toContain('already has games');
    });

    it('replaces games when force=true', async () => {
      const event = await seedEvent(testDb.db);
      const teams = [];
      for (let i = 1; i <= 4; i++) {
        const t = await seedTeam(testDb.db, {
          event_id: event.id,
          team_number: i,
        });
        await seedSeedingScore(testDb.db, {
          team_id: t.id,
          round_number: 1,
          score: 100 * (5 - i),
        });
        await seedSeedingScore(testDb.db, {
          team_id: t.id,
          round_number: 2,
          score: 90 * (5 - i),
        });
        teams.push(t);
      }
      await recalculateSeedingRankings(event.id);

      const bracket = await seedBracket(testDb.db, {
        event_id: event.id,
        bracket_size: 4,
      });

      await http.post(`${baseUrl}/brackets/${bracket.id}/entries/generate`);
      await http.post(`${baseUrl}/brackets/${bracket.id}/games/generate`);

      const res = await http.post(
        `${baseUrl}/brackets/${bracket.id}/games/generate?force=true`,
      );
      expect(res.status).toBe(200);
      expect((res.json as { gamesCreated: number }).gamesCreated).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // POST /brackets with team_ids - additional validation tests
  // ==========================================================================

  describe('POST /brackets with team_ids - validation', () => {
    it('returns 400 when event_id missing with team_ids', async () => {
      const res = await http.post(`${baseUrl}/brackets`, {
        name: 'Test',
        team_ids: [1, 2],
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('event_id and name');
    });

    it('returns 400 when name missing with team_ids', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.post(`${baseUrl}/brackets`, {
        event_id: event.id,
        team_ids: [1, 2],
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when event does not exist', async () => {
      const res = await http.post(`${baseUrl}/brackets`, {
        event_id: 99999,
        name: 'Test',
        team_ids: [1, 2],
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('Event does not exist');
    });

    it('returns 400 when team_ids has duplicates', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const res = await http.post(`${baseUrl}/brackets`, {
        event_id: event.id,
        name: 'Test',
        team_ids: [team.id, team.id],
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('unique');
    });

    it('returns 400 when team_ids contains non-existent team', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const res = await http.post(`${baseUrl}/brackets`, {
        event_id: event.id,
        name: 'Test',
        team_ids: [team.id, 99999],
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('not found');
    });
  });

  // ==========================================================================
  // POST /brackets/games/:id/advance - loser advancement
  // ==========================================================================

  describe('POST /brackets/games/:id/advance - loser advancement', () => {
    it('advances both winner and loser in double elimination', async () => {
      const event = await seedEvent(testDb.db);
      const bracket = await seedBracket(testDb.db, { event_id: event.id });
      const t1 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const t2 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 2,
      });

      // Create destination games
      const winnerDest = await testDb.db.run(
        `INSERT INTO bracket_games (bracket_id, game_number, round_name, round_number, bracket_side, status)
         VALUES (?, 3, 'Winners Final', 2, 'winners', 'pending')`,
        [bracket.id],
      );
      const loserDest = await testDb.db.run(
        `INSERT INTO bracket_games (bracket_id, game_number, round_name, round_number, bracket_side, status)
         VALUES (?, 4, 'Losers R1', 1, 'losers', 'pending')`,
        [bracket.id],
      );

      // Create source game with both winner and loser advancement
      await testDb.db.run(
        `INSERT INTO bracket_games (bracket_id, game_number, round_name, round_number, bracket_side, team1_id, team2_id, winner_id, loser_id, status, winner_advances_to_id, winner_slot, loser_advances_to_id, loser_slot)
         VALUES (?, 1, 'Winners R1', 1, 'winners', ?, ?, ?, ?, 'completed', ?, 'team1', ?, 'team1')`,
        [bracket.id, t1.id, t2.id, t1.id, t2.id, winnerDest.lastID, loserDest.lastID],
      );
      const sourceGame = await testDb.db.get(
        "SELECT id FROM bracket_games WHERE bracket_id = ? AND game_number = 1",
        [bracket.id],
      );

      const res = await http.post(
        `${baseUrl}/brackets/games/${sourceGame.id}/advance`,
      );
      expect(res.status).toBe(200);
      const body = res.json as { updates: unknown[] };
      expect(body.updates).toHaveLength(2);

      // Verify winner advanced
      const updatedWinner = await testDb.db.get(
        'SELECT team1_id FROM bracket_games WHERE id = ?',
        [winnerDest.lastID],
      );
      expect(updatedWinner.team1_id).toBe(t1.id);

      // Verify loser advanced
      const updatedLoser = await testDb.db.get(
        'SELECT team1_id FROM bracket_games WHERE id = ?',
        [loserDest.lastID],
      );
      expect(updatedLoser.team1_id).toBe(t2.id);
    });
  });
});
