/**
 * Additional HTTP tests for scores PUT and DELETE endpoints,
 * plus edge cases in score listing and revert.
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
  seedScoresheetTemplate,
  seedScoreSubmission,
  seedSeedingScore,
} from './helpers/seed';
import scoresRoutes from '../../src/server/routes/scores';

describe('Scores Routes – CRUD extra coverage', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;
  let adminUser: { id: number };

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    const user = await seedUser(testDb.db, { is_admin: true });
    adminUser = user;

    const app = createTestApp({
      user: { id: adminUser.id, is_admin: true },
    });
    app.use('/scores', scoresRoutes);
    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  describe('PUT /scores/:id', () => {
    it('updates scoreData successfully', async () => {
      const event = await seedEvent(testDb.db);
      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({ total: 50 }),
        event_id: event.id,
        score_type: 'seeding',
      });

      const res = await http.put(`${baseUrl}/scores/${score.id}`, {
        scoreData: { total: 100 },
      });
      expect(res.status).toBe(200);
      expect((res.json as { success: boolean }).success).toBe(true);

      const updated = await testDb.db.get(
        'SELECT score_data FROM score_submissions WHERE id = ?',
        [score.id],
      );
      expect(JSON.parse(updated.score_data)).toEqual({ total: 100 });
    });

    it('creates audit entry for event-scoped score update', async () => {
      const event = await seedEvent(testDb.db);
      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({ total: 50 }),
        event_id: event.id,
        score_type: 'seeding',
      });

      await http.put(`${baseUrl}/scores/${score.id}`, {
        scoreData: { total: 200 },
      });

      const audit = await testDb.db.get(
        "SELECT * FROM audit_log WHERE action = 'score_updated' AND entity_id = ?",
        [score.id],
      );
      expect(audit).toBeDefined();
      expect(audit.event_id).toBe(event.id);
    });

    it('returns 404 when score not found', async () => {
      const res = await http.put(`${baseUrl}/scores/99999`, {
        scoreData: { total: 100 },
      });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /scores/:id', () => {
    it('deletes a score submission', async () => {
      const event = await seedEvent(testDb.db);
      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({}),
        event_id: event.id,
        score_type: 'seeding',
      });

      const res = await http.delete(`${baseUrl}/scores/${score.id}`);
      expect(res.status).toBe(200);
      expect((res.json as { success: boolean }).success).toBe(true);

      const row = await testDb.db.get(
        'SELECT id FROM score_submissions WHERE id = ?',
        [score.id],
      );
      expect(row).toBeUndefined();
    });

    it('creates audit entry when deleting event-scoped score', async () => {
      const event = await seedEvent(testDb.db);
      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({}),
        event_id: event.id,
        score_type: 'seeding',
      });

      await http.delete(`${baseUrl}/scores/${score.id}`);

      const audit = await testDb.db.get(
        "SELECT * FROM audit_log WHERE action = 'score_deleted' AND entity_id = ?",
        [score.id],
      );
      expect(audit).toBeDefined();
      expect(audit.event_id).toBe(event.id);
    });

    it('returns success even for nonexistent score', async () => {
      const res = await http.delete(`${baseUrl}/scores/99999`);
      expect(res.status).toBe(200);
    });
  });

  describe('POST /scores/:id/revert-event – seeding with linked score', () => {
    it('performs full seeding revert with linked seeding_score', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const seedingScore = await seedSeedingScore(testDb.db, {
        team_id: team.id,
        round_number: 1,
        score: 100,
      });
      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({
          team_id: { value: team.id },
          round: { value: 1 },
        }),
        event_id: event.id,
        score_type: 'seeding',
        status: 'accepted',
        seeding_score_id: seedingScore.id,
      });

      // Dry run first
      const dryRes = await http.post(
        `${baseUrl}/scores/${score.id}/revert-event`,
        { dryRun: true },
      );
      expect(dryRes.status).toBe(200);
      const dryBody = dryRes.json as {
        requiresConfirmation: boolean;
        scoreType: string;
      };
      expect(dryBody.scoreType).toBe('seeding');
      expect(dryBody.requiresConfirmation).toBe(false);

      // Actual revert (neither dryRun nor confirm=undefined goes to actual revert)
      const res = await http.post(
        `${baseUrl}/scores/${score.id}/revert-event`,
        {},
      );
      expect(res.status).toBe(200);
      const body = res.json as { success: boolean; scoreType: string };
      expect(body.success).toBe(true);
      expect(body.scoreType).toBe('seeding');

      const deletedScore = await testDb.db.get(
        'SELECT id FROM seeding_scores WHERE id = ?',
        [seedingScore.id],
      );
      expect(deletedScore).toBeUndefined();

      const updatedSubmission = await testDb.db.get(
        'SELECT status FROM score_submissions WHERE id = ?',
        [score.id],
      );
      expect(updatedSubmission.status).toBe('pending');
    });
  });

  describe('POST /scores/:id/revert-event – bracket without downstream', () => {
    it('reverts bracket score when game has winner but no downstream cascade', async () => {
      const event = await seedEvent(testDb.db);
      const team1 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const team2 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 2,
      });
      const bracket = await seedBracket(testDb.db, { event_id: event.id });

      // Single game, no downstream
      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: team1.id,
        team2_id: team2.id,
        status: 'completed',
      });

      await testDb.db.run(
        'UPDATE bracket_games SET winner_id = ?, loser_id = ? WHERE id = ?',
        [team1.id, team2.id, game.id],
      );

      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({}),
        event_id: event.id,
        score_type: 'bracket',
        bracket_game_id: game.id,
        status: 'accepted',
      });

      // No confirm needed since no downstream games
      const res = await http.post(
        `${baseUrl}/scores/${score.id}/revert-event`,
        {},
      );
      expect(res.status).toBe(200);
      const body = res.json as { success: boolean; revertedGames: number };
      expect(body.success).toBe(true);
      expect(body.revertedGames).toBe(1);

      const updatedGame = await testDb.db.get(
        'SELECT winner_id, status FROM bracket_games WHERE id = ?',
        [game.id],
      );
      expect(updatedGame.winner_id).toBeNull();
      expect(updatedGame.status).toBe('ready');
    });
  });

  describe('POST /scores/:id/revert (simple revert)', () => {
    it('reverts an accepted score to pending', async () => {
      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({ total: 100 }),
        status: 'accepted',
      });

      const res = await http.post(`${baseUrl}/scores/${score.id}/revert`, {});
      expect(res.status).toBe(200);
      expect((res.json as { success: boolean }).success).toBe(true);

      const updated = await testDb.db.get(
        'SELECT status, reviewed_by FROM score_submissions WHERE id = ?',
        [score.id],
      );
      expect(updated.status).toBe('pending');
      expect(updated.reviewed_by).toBeNull();
    });

    it('returns 404 when score not found', async () => {
      const res = await http.post(`${baseUrl}/scores/99999/revert`, {});
      expect(res.status).toBe(404);
    });
  });

  describe('GET /scores/by-event/:eventId', () => {
    it('filters by status', async () => {
      const event = await seedEvent(testDb.db);
      const template = await seedScoresheetTemplate(testDb.db);
      await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({}),
        event_id: event.id,
        score_type: 'seeding',
        status: 'pending',
      });
      await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({}),
        event_id: event.id,
        score_type: 'seeding',
        status: 'accepted',
      });

      const res = await http.get(
        `${baseUrl}/scores/by-event/${event.id}?status=pending`,
      );
      expect(res.status).toBe(200);
      const body = res.json as { rows: { status: string }[] };
      expect(body.rows.every((s) => s.status === 'pending')).toBe(true);
    });

    it('filters by score_type', async () => {
      const event = await seedEvent(testDb.db);
      const template = await seedScoresheetTemplate(testDb.db);
      await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({}),
        event_id: event.id,
        score_type: 'seeding',
        status: 'pending',
      });
      await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({}),
        event_id: event.id,
        score_type: 'bracket',
        status: 'pending',
      });

      const res = await http.get(
        `${baseUrl}/scores/by-event/${event.id}?score_type=bracket`,
      );
      expect(res.status).toBe(200);
      const body = res.json as { rows: { score_type: string }[] };
      expect(body.rows.every((s) => s.score_type === 'bracket')).toBe(true);
    });

    it('paginates results', async () => {
      const event = await seedEvent(testDb.db);
      const template = await seedScoresheetTemplate(testDb.db);
      for (let i = 0; i < 5; i++) {
        await seedScoreSubmission(testDb.db, {
          template_id: template.id,
          score_data: JSON.stringify({ idx: i }),
          event_id: event.id,
          score_type: 'seeding',
          status: 'pending',
        });
      }

      const res = await http.get(
        `${baseUrl}/scores/by-event/${event.id}?page=1&limit=2`,
      );
      expect(res.status).toBe(200);
      const body = res.json as {
        rows: unknown[];
        totalCount: number;
        page: number;
        limit: number;
      };
      expect(body.rows.length).toBe(2);
      expect(body.totalCount).toBe(5);
      expect(body.page).toBe(1);
      expect(body.limit).toBe(2);
    });

    it('returns 404 when event does not exist', async () => {
      const res = await http.get(`${baseUrl}/scores/by-event/99999`);
      expect(res.status).toBe(404);
    });
  });
});
