/**
 * HTTP route tests for bracket CRUD, entries, games, and winner advancement.
 * Targets the large uncovered portions of src/server/routes/brackets.ts.
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
  seedBracketGame,
} from './helpers/seed';
import bracketsRoutes from '../../src/server/routes/brackets';

describe('Brackets CRUD & Game Management', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;
  let authUser: { id: number };

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
    authUser = await seedUser(testDb.db);
    const app = createTestApp({ user: { id: authUser.id, is_admin: false } });
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
  // GET /brackets/:id
  // ==========================================================================

  describe('GET /brackets/:id', () => {
    it('returns bracket with entries and games', async () => {
      const event = await seedEvent(testDb.db);
      const bracket = await seedBracket(testDb.db, { event_id: event.id });
      const team1 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const team2 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 2,
      });

      await testDb.db.run(
        `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye) VALUES (?, ?, 1, 0)`,
        [bracket.id, team1.id],
      );
      await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: team1.id,
        team2_id: team2.id,
      });

      const res = await http.get(`${baseUrl}/brackets/${bracket.id}`);
      expect(res.status).toBe(200);

      const body = res.json as {
        id: number;
        entries: unknown[];
        games: unknown[];
      };
      expect(body.id).toBe(bracket.id);
      expect(body.entries).toHaveLength(1);
      expect(body.games).toHaveLength(1);
    });

    it('returns 404 for non-existent bracket', async () => {
      const res = await http.get(`${baseUrl}/brackets/9999`);
      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // GET /brackets/event/:eventId
  // ==========================================================================

  describe('GET /brackets/event/:eventId', () => {
    it('returns brackets for event', async () => {
      const event = await seedEvent(testDb.db);
      await seedBracket(testDb.db, { event_id: event.id, name: 'Bracket A' });
      await seedBracket(testDb.db, { event_id: event.id, name: 'Bracket B' });

      const res = await http.get(
        `${baseUrl}/brackets/event/${event.id}`,
      );
      expect(res.status).toBe(200);
      expect(res.json as unknown[]).toHaveLength(2);
    });

    it('returns empty array when event has no brackets', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.get(
        `${baseUrl}/brackets/event/${event.id}`,
      );
      expect(res.status).toBe(200);
      expect(res.json).toEqual([]);
    });
  });

  // ==========================================================================
  // GET /brackets/templates
  // ==========================================================================

  describe('GET /brackets/templates', () => {
    it('returns all bracket templates', async () => {
      const res = await http.get(`${baseUrl}/brackets/templates`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.json)).toBe(true);
    });

    it('filters by bracket_size when provided', async () => {
      await http.post(`${baseUrl}/brackets/templates`, {
        bracket_size: 4,
        game_number: 1,
        round_name: 'R1',
        round_number: 1,
        bracket_side: 'winners',
        team1_source: 'seed:1',
        team2_source: 'seed:2',
      });
      await http.post(`${baseUrl}/brackets/templates`, {
        bracket_size: 8,
        game_number: 1,
        round_name: 'R1',
        round_number: 1,
        bracket_side: 'winners',
        team1_source: 'seed:1',
        team2_source: 'seed:8',
      });

      const res = await http.get(`${baseUrl}/brackets/templates?bracket_size=4`);
      expect(res.status).toBe(200);
      const templates = res.json as { bracket_size: number }[];
      expect(templates.every((t) => t.bracket_size === 4)).toBe(true);
    });
  });

  describe('GET /brackets/event/:eventId/assigned-teams', () => {
    it('returns teams assigned to brackets for event', async () => {
      const event = await seedEvent(testDb.db);
      const bracket = await seedBracket(testDb.db, { event_id: event.id });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
        team_name: 'Assigned',
      });
      await testDb.db.run(
        `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye) VALUES (?, ?, 1, 0)`,
        [bracket.id, team.id],
      );

      const res = await http.get(
        `${baseUrl}/brackets/event/${event.id}/assigned-teams`,
      );
      expect(res.status).toBe(200);
      const assigned = res.json as { team_number: number; team_name: string }[];
      expect(assigned.length).toBe(1);
      expect(assigned[0].team_number).toBe(1);
      expect(assigned[0].team_name).toBe('Assigned');
    });

    it('returns 401 when not authenticated', async () => {
      const event = await seedEvent(testDb.db);
      const app = createTestApp();
      app.use('/brackets', bracketsRoutes);
      const unauthServer = await startServer(app);

      try {
        const res = await http.get(
          `${unauthServer.baseUrl}/brackets/event/${event.id}/assigned-teams`,
        );
        expect(res.status).toBe(401);
      } finally {
        await unauthServer.close();
      }
    });
  });

  // ==========================================================================
  // POST /brackets (legacy flow)
  // ==========================================================================

  describe('POST /brackets (legacy)', () => {
    it('creates bracket with bracket_size', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.post(`${baseUrl}/brackets`, {
        event_id: event.id,
        name: 'Legacy Bracket',
        bracket_size: 8,
      });
      expect(res.status).toBe(201);
      const body = res.json as { id: number; name: string; bracket_size: number };
      expect(body.name).toBe('Legacy Bracket');
      expect(body.bracket_size).toBe(8);
    });

    it('returns 400 when missing required fields', async () => {
      const res = await http.post(`${baseUrl}/brackets`, {
        name: 'No Event',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid event_id', async () => {
      const res = await http.post(`${baseUrl}/brackets`, {
        event_id: 99999,
        name: 'Bad',
        bracket_size: 8,
      });
      expect(res.status).toBe(400);
    });
  });

  // ==========================================================================
  // PATCH /brackets/:id
  // ==========================================================================

  describe('PATCH /brackets/:id', () => {
    it('updates bracket name', async () => {
      const event = await seedEvent(testDb.db);
      const bracket = await seedBracket(testDb.db, { event_id: event.id });

      const res = await http.patch(`${baseUrl}/brackets/${bracket.id}`, {
        name: 'Updated Name',
      });
      expect(res.status).toBe(200);
      expect((res.json as { name: string }).name).toBe('Updated Name');
    });

    it('updates bracket status', async () => {
      const event = await seedEvent(testDb.db);
      const bracket = await seedBracket(testDb.db, { event_id: event.id });

      const res = await http.patch(`${baseUrl}/brackets/${bracket.id}`, {
        status: 'in_progress',
      });
      expect(res.status).toBe(200);
      expect((res.json as { status: string }).status).toBe('in_progress');
    });

    it('returns 400 when no valid fields provided', async () => {
      const event = await seedEvent(testDb.db);
      const bracket = await seedBracket(testDb.db, { event_id: event.id });

      const res = await http.patch(`${baseUrl}/brackets/${bracket.id}`, {
        bogus_field: 'nope',
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent bracket', async () => {
      const res = await http.patch(`${baseUrl}/brackets/9999`, {
        name: 'Ghost',
      });
      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // DELETE /brackets/:id
  // ==========================================================================

  describe('DELETE /brackets/:id', () => {
    it('deletes bracket', async () => {
      const event = await seedEvent(testDb.db);
      const bracket = await seedBracket(testDb.db, { event_id: event.id });

      const res = await http.delete(`${baseUrl}/brackets/${bracket.id}`);
      expect(res.status).toBe(204);

      const check = await http.get(`${baseUrl}/brackets/${bracket.id}`);
      expect(check.status).toBe(404);
    });
  });

  // ==========================================================================
  // POST /brackets/:id/entries
  // ==========================================================================

  describe('POST /brackets/:id/entries', () => {
    it('creates bracket entry with team', async () => {
      const event = await seedEvent(testDb.db);
      const bracket = await seedBracket(testDb.db, { event_id: event.id });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });

      const res = await http.post(
        `${baseUrl}/brackets/${bracket.id}/entries`,
        { team_id: team.id, seed_position: 1 },
      );
      expect(res.status).toBe(201);
      const body = res.json as { seed_position: number; team_id: number };
      expect(body.seed_position).toBe(1);
      expect(body.team_id).toBe(team.id);
    });

    it('creates bye entry', async () => {
      const event = await seedEvent(testDb.db);
      const bracket = await seedBracket(testDb.db, { event_id: event.id });

      const res = await http.post(
        `${baseUrl}/brackets/${bracket.id}/entries`,
        { seed_position: 8, is_bye: true },
      );
      expect(res.status).toBe(201);
    });

    it('returns 400 when seed_position missing', async () => {
      const event = await seedEvent(testDb.db);
      const bracket = await seedBracket(testDb.db, { event_id: event.id });

      const res = await http.post(
        `${baseUrl}/brackets/${bracket.id}/entries`,
        { team_id: 1 },
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 when bracket does not exist', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });

      const res = await http.post(`${baseUrl}/brackets/9999/entries`, {
        team_id: team.id,
        seed_position: 1,
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 when team does not exist', async () => {
      const event = await seedEvent(testDb.db);
      const bracket = await seedBracket(testDb.db, { event_id: event.id });

      const res = await http.post(
        `${baseUrl}/brackets/${bracket.id}/entries`,
        { team_id: 9999, seed_position: 1 },
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when team belongs to different event', async () => {
      const event1 = await seedEvent(testDb.db, { name: 'Event 1' });
      const event2 = await seedEvent(testDb.db, { name: 'Event 2' });
      const bracket = await seedBracket(testDb.db, { event_id: event1.id });
      const team = await seedTeam(testDb.db, {
        event_id: event2.id,
        team_number: 1,
      });

      const res = await http.post(
        `${baseUrl}/brackets/${bracket.id}/entries`,
        { team_id: team.id, seed_position: 1 },
      );
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('same event');
    });

    it('returns 409 on duplicate seed position', async () => {
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

      await http.post(`${baseUrl}/brackets/${bracket.id}/entries`, {
        team_id: t1.id,
        seed_position: 1,
      });
      const res = await http.post(
        `${baseUrl}/brackets/${bracket.id}/entries`,
        { team_id: t2.id, seed_position: 1 },
      );
      expect(res.status).toBe(409);
    });
  });

  // ==========================================================================
  // DELETE /brackets/:bracketId/entries/:entryId
  // ==========================================================================

  describe('DELETE /brackets/:bracketId/entries/:entryId', () => {
    it('removes entry', async () => {
      const event = await seedEvent(testDb.db);
      const bracket = await seedBracket(testDb.db, { event_id: event.id });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });

      const createRes = await http.post(
        `${baseUrl}/brackets/${bracket.id}/entries`,
        { team_id: team.id, seed_position: 1 },
      );
      const entry = createRes.json as { id: number };

      const res = await http.delete(
        `${baseUrl}/brackets/${bracket.id}/entries/${entry.id}`,
      );
      expect(res.status).toBe(204);

      const entries = await testDb.db.all(
        'SELECT * FROM bracket_entries WHERE bracket_id = ?',
        [bracket.id],
      );
      expect(entries).toHaveLength(0);
    });
  });

  // ==========================================================================
  // GET /brackets/:id/games
  // ==========================================================================

  describe('GET /brackets/:id/games', () => {
    it('returns games with team info', async () => {
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

      await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: t1.id,
        team2_id: t2.id,
        status: 'ready',
      });

      const res = await http.get(
        `${baseUrl}/brackets/${bracket.id}/games`,
      );
      expect(res.status).toBe(200);
      const games = res.json as { game_number: number; team1_number: number }[];
      expect(games).toHaveLength(1);
      expect(games[0].team1_number).toBe(1);
    });

    it('returns empty array when no games exist', async () => {
      const event = await seedEvent(testDb.db);
      const bracket = await seedBracket(testDb.db, { event_id: event.id });

      const res = await http.get(
        `${baseUrl}/brackets/${bracket.id}/games`,
      );
      expect(res.status).toBe(200);
      expect(res.json).toEqual([]);
    });
  });

  // ==========================================================================
  // POST /brackets/:id/games
  // ==========================================================================

  describe('POST /brackets/:id/games', () => {
    it('creates a game', async () => {
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

      const res = await http.post(
        `${baseUrl}/brackets/${bracket.id}/games`,
        {
          game_number: 1,
          round_name: 'Semis',
          round_number: 1,
          bracket_side: 'winners',
          team1_id: t1.id,
          team2_id: t2.id,
        },
      );
      expect(res.status).toBe(201);
      const game = res.json as { game_number: number; round_name: string };
      expect(game.game_number).toBe(1);
      expect(game.round_name).toBe('Semis');
    });

    it('returns 400 when game_number missing', async () => {
      const event = await seedEvent(testDb.db);
      const bracket = await seedBracket(testDb.db, { event_id: event.id });

      const res = await http.post(
        `${baseUrl}/brackets/${bracket.id}/games`,
        { round_name: 'Round 1' },
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 when bracket does not exist', async () => {
      const res = await http.post(`${baseUrl}/brackets/9999/games`, {
        game_number: 1,
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 when team belongs to different event', async () => {
      const event1 = await seedEvent(testDb.db, { name: 'E1' });
      const event2 = await seedEvent(testDb.db, { name: 'E2' });
      const bracket = await seedBracket(testDb.db, { event_id: event1.id });
      const team = await seedTeam(testDb.db, {
        event_id: event2.id,
        team_number: 1,
      });

      const res = await http.post(
        `${baseUrl}/brackets/${bracket.id}/games`,
        { game_number: 1, team1_id: team.id },
      );
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('same event');
    });

    it('returns 409 on duplicate game_number', async () => {
      const event = await seedEvent(testDb.db);
      const bracket = await seedBracket(testDb.db, { event_id: event.id });

      await http.post(`${baseUrl}/brackets/${bracket.id}/games`, {
        game_number: 1,
      });
      const res = await http.post(
        `${baseUrl}/brackets/${bracket.id}/games`,
        { game_number: 1 },
      );
      expect(res.status).toBe(409);
    });
  });

  // ==========================================================================
  // PATCH /brackets/games/:id
  // ==========================================================================

  describe('PATCH /brackets/games/:id', () => {
    it('updates game scores and status', async () => {
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
      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: t1.id,
        team2_id: t2.id,
        status: 'ready',
      });

      const res = await http.patch(`${baseUrl}/brackets/games/${game.id}`, {
        team1_score: 100,
        team2_score: 80,
        winner_id: t1.id,
        status: 'completed',
      });
      expect(res.status).toBe(200);
      const body = res.json as {
        team1_score: number;
        team2_score: number;
        winner_id: number;
        status: string;
      };
      expect(body.team1_score).toBe(100);
      expect(body.team2_score).toBe(80);
      expect(body.winner_id).toBe(t1.id);
      expect(body.status).toBe('completed');
    });

    it('returns 400 when no valid fields', async () => {
      const event = await seedEvent(testDb.db);
      const bracket = await seedBracket(testDb.db, { event_id: event.id });
      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
      });

      const res = await http.patch(`${baseUrl}/brackets/games/${game.id}`, {
        invalid_field: 'nope',
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent game', async () => {
      const res = await http.patch(`${baseUrl}/brackets/games/9999`, {
        status: 'completed',
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 when team belongs to different event', async () => {
      const event1 = await seedEvent(testDb.db, { name: 'E1' });
      const event2 = await seedEvent(testDb.db, { name: 'E2' });
      const bracket = await seedBracket(testDb.db, { event_id: event1.id });
      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
      });
      const foreignTeam = await seedTeam(testDb.db, {
        event_id: event2.id,
        team_number: 1,
      });

      const res = await http.patch(`${baseUrl}/brackets/games/${game.id}`, {
        winner_id: foreignTeam.id,
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('same event');
    });
  });

  // ==========================================================================
  // POST /brackets/games/:id/advance
  // ==========================================================================

  describe('POST /brackets/games/:id/advance', () => {
    it('advances winner to next game', async () => {
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

      const finalGame = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 2,
        status: 'pending',
      });

      await testDb.db.run(
        `INSERT INTO bracket_games (bracket_id, game_number, round_name, round_number, bracket_side, team1_id, team2_id, winner_id, status, winner_advances_to_id, winner_slot)
         VALUES (?, 1, 'Semi', 1, 'winners', ?, ?, ?, 'completed', ?, 'team1')`,
        [bracket.id, t1.id, t2.id, t1.id, finalGame.id],
      );
      const semiGame = await testDb.db.get(
        "SELECT id FROM bracket_games WHERE bracket_id = ? AND game_number = 1",
        [bracket.id],
      );

      const res = await http.post(
        `${baseUrl}/brackets/games/${semiGame.id}/advance`,
      );
      expect(res.status).toBe(200);
      const body = res.json as { message: string; updates: unknown[] };
      expect(body.message).toBe('Winner advanced');
      expect(body.updates).toHaveLength(1);

      const updatedFinal = await testDb.db.get(
        'SELECT team1_id FROM bracket_games WHERE id = ?',
        [finalGame.id],
      );
      expect(updatedFinal.team1_id).toBe(t1.id);
    });

    it('returns 404 for non-existent game', async () => {
      const res = await http.post(
        `${baseUrl}/brackets/games/9999/advance`,
      );
      expect(res.status).toBe(404);
    });

    it('returns 400 when game has no winner', async () => {
      const event = await seedEvent(testDb.db);
      const bracket = await seedBracket(testDb.db, { event_id: event.id });
      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        status: 'ready',
      });

      const res = await http.post(
        `${baseUrl}/brackets/games/${game.id}/advance`,
      );
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('no winner');
    });
  });

  // ==========================================================================
  // POST /brackets/:id/advance-winner
  // ==========================================================================

  describe('POST /brackets/:id/advance-winner', () => {
    it('sets winner, advances, and marks destination ready', async () => {
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
      const t3 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 3,
      });

      const finalGame = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 3,
        team1_id: t3.id,
        status: 'pending',
      });

      await testDb.db.run(
        `INSERT INTO bracket_games (bracket_id, game_number, round_name, round_number, bracket_side, team1_id, team2_id, status, winner_advances_to_id, winner_slot)
         VALUES (?, 1, 'Semi', 1, 'winners', ?, ?, 'ready', ?, 'team2')`,
        [bracket.id, t1.id, t2.id, finalGame.id],
      );
      const semiGame = await testDb.db.get(
        "SELECT id FROM bracket_games WHERE bracket_id = ? AND game_number = 1",
        [bracket.id],
      );

      const res = await http.post(
        `${baseUrl}/brackets/${bracket.id}/advance-winner`,
        { game_id: semiGame.id, winner_id: t2.id },
      );
      expect(res.status).toBe(200);
      const body = res.json as {
        winner_id: number;
        loser_id: number;
        updates: unknown[];
      };
      expect(body.winner_id).toBe(t2.id);
      expect(body.loser_id).toBe(t1.id);

      const updatedFinal = await testDb.db.get(
        'SELECT team2_id, status FROM bracket_games WHERE id = ?',
        [finalGame.id],
      );
      expect(updatedFinal.team2_id).toBe(t2.id);
      expect(updatedFinal.status).toBe('ready');
    });

    it('returns 400 when game_id or winner_id missing', async () => {
      const event = await seedEvent(testDb.db);
      const bracket = await seedBracket(testDb.db, { event_id: event.id });

      const res = await http.post(
        `${baseUrl}/brackets/${bracket.id}/advance-winner`,
        {},
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 when game does not belong to bracket', async () => {
      const event = await seedEvent(testDb.db);
      const bracket = await seedBracket(testDb.db, { event_id: event.id });

      const res = await http.post(
        `${baseUrl}/brackets/${bracket.id}/advance-winner`,
        { game_id: 9999, winner_id: 1 },
      );
      expect(res.status).toBe(404);
    });

    it('returns 400 when game is already completed', async () => {
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

      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: t1.id,
        team2_id: t2.id,
        status: 'completed',
      });

      const res = await http.post(
        `${baseUrl}/brackets/${bracket.id}/advance-winner`,
        { game_id: game.id, winner_id: t1.id },
      );
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'already completed',
      );
    });

    it('returns 400 when winner is not a participant', async () => {
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
      const t3 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 3,
      });

      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: t1.id,
        team2_id: t2.id,
        status: 'ready',
      });

      const res = await http.post(
        `${baseUrl}/brackets/${bracket.id}/advance-winner`,
        { game_id: game.id, winner_id: t3.id },
      );
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'one of the teams',
      );
    });
  });

  // ==========================================================================
  // POST /brackets/templates
  // ==========================================================================

  describe('POST /brackets/templates', () => {
    it('creates a bracket template', async () => {
      const res = await http.post(`${baseUrl}/brackets/templates`, {
        bracket_size: 4,
        game_number: 1,
        round_name: 'Semi',
        round_number: 1,
        bracket_side: 'winners',
        team1_source: 'seed:1',
        team2_source: 'seed:4',
      });
      expect(res.status).toBe(201);
      const body = res.json as { bracket_size: number; game_number: number };
      expect(body.bracket_size).toBe(4);
      expect(body.game_number).toBe(1);
    });

    it('returns 400 when required fields missing', async () => {
      const res = await http.post(`${baseUrl}/brackets/templates`, {
        bracket_size: 4,
      });
      expect(res.status).toBe(400);
    });

    it('returns 409 on duplicate game_number for same bracket_size', async () => {
      const templateData = {
        bracket_size: 4,
        game_number: 99,
        round_name: 'R1',
        round_number: 1,
        bracket_side: 'winners',
        team1_source: 'seed:1',
        team2_source: 'seed:2',
      };
      await http.post(`${baseUrl}/brackets/templates`, templateData);
      const res = await http.post(
        `${baseUrl}/brackets/templates`,
        templateData,
      );
      expect(res.status).toBe(409);
      expect((res.json as { error: string }).error).toContain(
        'Game number already exists',
      );
    });

    it('returns 400 when winner_slot has invalid value', async () => {
      const res = await http.post(`${baseUrl}/brackets/templates`, {
        bracket_size: 4,
        game_number: 88,
        round_name: 'R1',
        round_number: 1,
        bracket_side: 'winners',
        team1_source: 'seed:1',
        team2_source: 'seed:2',
        winner_slot: 'invalid_slot',
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'Invalid winner_slot value',
      );
    });
  });

  // ==========================================================================
  // Authentication boundaries
  // ==========================================================================

  describe('Authentication', () => {
    it('returns 401 for unauthenticated POST /brackets', async () => {
      await server.close();
      const app = createTestApp();
      app.use('/brackets', bracketsRoutes);
      server = await startServer(app);
      baseUrl = server.baseUrl;

      const res = await http.post(`${baseUrl}/brackets`, {
        event_id: 1,
        name: 'Test',
        bracket_size: 8,
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 for unauthenticated PATCH /brackets/:id', async () => {
      await server.close();
      const app = createTestApp();
      app.use('/brackets', bracketsRoutes);
      server = await startServer(app);
      baseUrl = server.baseUrl;

      const res = await http.patch(`${baseUrl}/brackets/1`, {
        name: 'New',
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 for unauthenticated DELETE /brackets/:id', async () => {
      await server.close();
      const app = createTestApp();
      app.use('/brackets', bracketsRoutes);
      server = await startServer(app);
      baseUrl = server.baseUrl;

      const res = await http.delete(`${baseUrl}/brackets/1`);
      expect(res.status).toBe(401);
    });
  });
});
