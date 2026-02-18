/**
 * HTTP route tests for event-scoped scoring endpoints.
 * Tests GET /scores/by-event/:eventId, POST /scores/:id/accept-event, POST /scores/:id/revert-event.
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
  seedSpreadsheetConfig,
  seedScoreSubmission,
  seedQueueItem,
} from './helpers/seed';
import scoresRoutes from '../../src/server/routes/scores';

describe('Event-Scoped Scores Routes', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(async () => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  // ==========================================================================
  // Authentication and Authorization Tests
  // ==========================================================================

  describe('Authentication Boundaries', () => {
    describe('GET /scores/by-event/:eventId', () => {
      it('returns 403 when not authenticated', async () => {
        const app = createTestApp();
        app.use('/scores', scoresRoutes);
        const server = await startServer(app);

        try {
          const res = await http.get(`${server.baseUrl}/scores/by-event/1`);
          expect(res.status).toBe(403);
          expect((res.json as { error: string }).error).toContain(
            'Admin access required',
          );
        } finally {
          await server.close();
        }
      });

      it('returns 403 when authenticated but not admin', async () => {
        const app = createTestApp({ user: { id: 1, is_admin: false } });
        app.use('/scores', scoresRoutes);
        const server = await startServer(app);

        try {
          const res = await http.get(`${server.baseUrl}/scores/by-event/1`);
          expect(res.status).toBe(403);
          expect((res.json as { error: string }).error).toContain(
            'Admin access required',
          );
        } finally {
          await server.close();
        }
      });

      it('returns 200 when admin', async () => {
        const event = await seedEvent(testDb.db);
        const app = createTestApp({ user: { id: 1, is_admin: true } });
        app.use('/scores', scoresRoutes);
        const server = await startServer(app);

        try {
          const res = await http.get(
            `${server.baseUrl}/scores/by-event/${event.id}`,
          );
          expect(res.status).toBe(200);
        } finally {
          await server.close();
        }
      });
    });

    describe('POST /scores/:id/accept-event', () => {
      it('returns 403 when not admin', async () => {
        const app = createTestApp({ user: { id: 1, is_admin: false } });
        app.use('/scores', scoresRoutes);
        const server = await startServer(app);

        try {
          const res = await http.post(
            `${server.baseUrl}/scores/1/accept-event`,
          );
          expect(res.status).toBe(403);
        } finally {
          await server.close();
        }
      });
    });

    describe('POST /scores/event/:eventId/accept/bulk', () => {
      it('returns 403 when not admin', async () => {
        const app = createTestApp({ user: { id: 1, is_admin: false } });
        app.use('/scores', scoresRoutes);
        const server = await startServer(app);

        try {
          const res = await http.post(
            `${server.baseUrl}/scores/event/1/accept/bulk`,
            { score_ids: [1] },
          );
          expect(res.status).toBe(403);
        } finally {
          await server.close();
        }
      });
    });

    describe('POST /scores/:id/revert-event', () => {
      it('returns 403 when not admin', async () => {
        const app = createTestApp({ user: { id: 1, is_admin: false } });
        app.use('/scores', scoresRoutes);
        const server = await startServer(app);

        try {
          const res = await http.post(
            `${server.baseUrl}/scores/1/revert-event`,
          );
          expect(res.status).toBe(403);
        } finally {
          await server.close();
        }
      });
    });
  });

  // ==========================================================================
  // GET /scores/by-event/:eventId
  // ==========================================================================

  describe('GET /scores/by-event/:eventId', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const app = createTestApp({ user: { id: 1, is_admin: true } });
      app.use('/scores', scoresRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 404 when event not found', async () => {
      const res = await http.get(`${server.baseUrl}/scores/by-event/999`);
      expect(res.status).toBe(404);
      expect((res.json as { error: string }).error).toContain(
        'Event not found',
      );
    });

    it('returns empty array when no scores exist', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.get(
        `${server.baseUrl}/scores/by-event/${event.id}`,
      );

      expect(res.status).toBe(200);
      const data = res.json as { rows: unknown[]; totalCount: number };
      expect(data.rows).toEqual([]);
      expect(data.totalCount).toBe(0);
    });

    it('returns scores with pagination info', async () => {
      const user = await seedUser(testDb.db);
      const event = await seedEvent(testDb.db);
      const config = await seedSpreadsheetConfig(testDb.db, {
        user_id: user.id,
      });
      const template = await seedScoresheetTemplate(testDb.db);

      await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: config.id,
        score_data: JSON.stringify({
          team_id: { value: 1 },
          round: { value: 1 },
        }),
        event_id: event.id,
        score_type: 'seeding',
      });

      const res = await http.get(
        `${server.baseUrl}/scores/by-event/${event.id}`,
      );

      expect(res.status).toBe(200);
      const data = res.json as {
        rows: unknown[];
        page: number;
        limit: number;
        totalCount: number;
        totalPages: number;
      };
      expect(data.rows.length).toBe(1);
      expect(data.page).toBe(1);
      expect(data.totalCount).toBe(1);
      expect(data.totalPages).toBe(1);
    });

    it('filters by status', async () => {
      const user = await seedUser(testDb.db);
      const event = await seedEvent(testDb.db);
      const config = await seedSpreadsheetConfig(testDb.db, {
        user_id: user.id,
      });
      const template = await seedScoresheetTemplate(testDb.db);

      await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: config.id,
        score_data: JSON.stringify({}),
        event_id: event.id,
        score_type: 'seeding',
        status: 'pending',
      });
      await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: config.id,
        score_data: JSON.stringify({}),
        event_id: event.id,
        score_type: 'seeding',
        status: 'accepted',
      });

      const res = await http.get(
        `${server.baseUrl}/scores/by-event/${event.id}?status=pending`,
      );

      expect(res.status).toBe(200);
      const data = res.json as {
        rows: { status: string }[];
        totalCount: number;
      };
      expect(data.totalCount).toBe(1);
      expect(data.rows[0].status).toBe('pending');
    });

    it('filters by score_type', async () => {
      const user = await seedUser(testDb.db);
      const event = await seedEvent(testDb.db);
      const config = await seedSpreadsheetConfig(testDb.db, {
        user_id: user.id,
      });
      const template = await seedScoresheetTemplate(testDb.db);

      await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: config.id,
        score_data: JSON.stringify({}),
        event_id: event.id,
        score_type: 'seeding',
      });
      await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: config.id,
        score_data: JSON.stringify({}),
        event_id: event.id,
        score_type: 'bracket',
      });

      const res = await http.get(
        `${server.baseUrl}/scores/by-event/${event.id}?score_type=bracket`,
      );

      expect(res.status).toBe(200);
      const data = res.json as {
        rows: { score_type: string }[];
        totalCount: number;
      };
      expect(data.totalCount).toBe(1);
      expect(data.rows[0].score_type).toBe('bracket');
    });

    it('returns DB-backed scores (spreadsheet_config_id null)', async () => {
      const event = await seedEvent(testDb.db);
      const template = await seedScoresheetTemplate(testDb.db);

      await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: null,
        score_data: JSON.stringify({
          team_id: { value: 1 },
          round: { value: 1 },
        }),
        event_id: event.id,
        score_type: 'seeding',
      });

      const res = await http.get(
        `${server.baseUrl}/scores/by-event/${event.id}`,
      );

      expect(res.status).toBe(200);
      const data = res.json as {
        rows: { spreadsheet_config_id: number | null }[];
        totalCount: number;
      };
      expect(data.totalCount).toBe(1);
      expect(data.rows[0].spreadsheet_config_id).toBeNull();
    });
  });

  // ==========================================================================
  // POST /scores/:id/accept-event
  // ==========================================================================

  describe('POST /scores/:id/accept-event', () => {
    let server: TestServerHandle;
    let adminUser: { id: number };

    beforeEach(async () => {
      adminUser = await seedUser(testDb.db, { is_admin: true });
      const app = createTestApp({ user: { id: adminUser.id, is_admin: true } });
      app.use('/scores', scoresRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 404 when score not found', async () => {
      const res = await http.post(`${server.baseUrl}/scores/999/accept-event`);
      expect(res.status).toBe(404);
      expect((res.json as { error: string }).error).toContain('not found');
    });

    it('returns 400 when score is not event-scoped', async () => {
      const config = await seedSpreadsheetConfig(testDb.db, {
        user_id: adminUser.id,
      });
      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: config.id,
        score_data: JSON.stringify({}),
        event_id: null, // Not event-scoped
      });

      const res = await http.post(
        `${server.baseUrl}/scores/${score.id}/accept-event`,
      );
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'not event-scoped',
      );
    });

    it('returns 400 when score is already accepted', async () => {
      const event = await seedEvent(testDb.db);
      const config = await seedSpreadsheetConfig(testDb.db, {
        user_id: adminUser.id,
      });
      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: config.id,
        score_data: JSON.stringify({}),
        event_id: event.id,
        score_type: 'seeding',
        status: 'accepted',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/${score.id}/accept-event`,
      );
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'already accepted',
      );
    });

    it('accepts seeding score and creates seeding_score record', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const config = await seedSpreadsheetConfig(testDb.db, {
        user_id: adminUser.id,
      });
      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: config.id,
        score_data: JSON.stringify({
          team_id: { value: team.id },
          round: { value: 1 },
          grand_total: { value: 150 },
        }),
        event_id: event.id,
        score_type: 'seeding',
        status: 'pending',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/${score.id}/accept-event`,
      );
      expect(res.status).toBe(200);
      const data = res.json as { success: boolean; scoreType: string };
      expect(data.success).toBe(true);
      expect(data.scoreType).toBe('seeding');

      // Verify seeding_score was created
      const seedingScore = await testDb.db.get(
        'SELECT * FROM seeding_scores WHERE team_id = ? AND round_number = ?',
        [team.id, 1],
      );
      expect(seedingScore).toBeDefined();
      expect(seedingScore.score).toBe(150);

      const auditLogs = await testDb.db.all(
        'SELECT * FROM audit_log WHERE event_id = ? AND action = ? AND entity_type = ? AND entity_id = ?',
        [event.id, 'score_accepted', 'score_submission', score.id],
      );
      expect(auditLogs.length).toBe(1);

      const updatedScore = await testDb.db.get(
        'SELECT reviewed_by, reviewed_at FROM score_submissions WHERE id = ?',
        [score.id],
      );
      expect(updatedScore.reviewed_by).toBe(adminUser.id);
      expect(updatedScore.reviewed_at).toBeTruthy();
    });

    it('accepts seeding score and marks matching queue item completed', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 1,
        seeding_team_id: team.id,
        seeding_round: 1,
        status: 'queued',
      });
      const config = await seedSpreadsheetConfig(testDb.db, {
        user_id: adminUser.id,
      });
      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: config.id,
        score_data: JSON.stringify({
          team_id: { value: team.id },
          round: { value: 1 },
          grand_total: { value: 150 },
        }),
        event_id: event.id,
        score_type: 'seeding',
        status: 'pending',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/${score.id}/accept-event`,
      );
      expect(res.status).toBe(200);

      const queueItem = await testDb.db.get(
        'SELECT * FROM game_queue WHERE event_id = ? AND seeding_team_id = ? AND seeding_round = ?',
        [event.id, team.id, 1],
      );
      expect(queueItem).toBeDefined();
      expect(queueItem.status).toBe('completed');
    });

    it('accepts bracket score and sets winner', async () => {
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
      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: team1.id,
        team2_id: team2.id,
        status: 'ready',
      });
      const config = await seedSpreadsheetConfig(testDb.db, {
        user_id: adminUser.id,
      });
      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: config.id,
        score_data: JSON.stringify({
          winner_team_id: { value: team1.id },
          team1_score: { value: 100 },
          team2_score: { value: 80 },
        }),
        event_id: event.id,
        score_type: 'bracket',
        bracket_game_id: game.id,
        status: 'pending',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/${score.id}/accept-event`,
      );
      expect(res.status).toBe(200);
      const data = res.json as {
        success: boolean;
        scoreType: string;
        winnerId: number;
      };
      expect(data.success).toBe(true);
      expect(data.scoreType).toBe('bracket');
      expect(data.winnerId).toBe(team1.id);

      // Verify game was updated
      const updatedGame = await testDb.db.get(
        'SELECT * FROM bracket_games WHERE id = ?',
        [game.id],
      );
      expect(updatedGame.winner_id).toBe(team1.id);
      expect(updatedGame.status).toBe('completed');

      const scoreAcceptedLogs = await testDb.db.all(
        'SELECT * FROM audit_log WHERE event_id = ? AND action = ? AND entity_type = ? AND entity_id = ?',
        [event.id, 'score_accepted', 'score_submission', score.id],
      );
      expect(scoreAcceptedLogs.length).toBe(1);

      const bracketGameLogs = await testDb.db.all(
        'SELECT * FROM audit_log WHERE event_id = ? AND action = ? AND entity_type = ? AND entity_id = ?',
        [event.id, 'bracket_game_completed', 'bracket_game', game.id],
      );
      expect(bracketGameLogs.length).toBe(1);

      const queueItem = await testDb.db.get(
        'SELECT * FROM game_queue WHERE event_id = ? AND bracket_game_id = ?',
        [event.id, game.id],
      );
      expect(queueItem).toBeDefined();
      expect(queueItem.status).toBe('completed');
    });

    it('returns 409 conflict when seeding score already exists', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const config = await seedSpreadsheetConfig(testDb.db, {
        user_id: adminUser.id,
      });
      const template = await seedScoresheetTemplate(testDb.db);

      // Create existing seeding score
      await testDb.db.run(
        'INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, ?, ?)',
        [team.id, 1, 100],
      );

      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: config.id,
        score_data: JSON.stringify({
          team_id: { value: team.id },
          round: { value: 1 },
          grand_total: { value: 150 },
        }),
        event_id: event.id,
        score_type: 'seeding',
        status: 'pending',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/${score.id}/accept-event`,
      );
      expect(res.status).toBe(409);
      const data = res.json as { error: string; existingScore: number };
      expect(data.existingScore).toBe(100);
    });

    it('overrides with force=true', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const config = await seedSpreadsheetConfig(testDb.db, {
        user_id: adminUser.id,
      });
      const template = await seedScoresheetTemplate(testDb.db);

      // Create existing seeding score
      await testDb.db.run(
        'INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, ?, ?)',
        [team.id, 1, 100],
      );

      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: config.id,
        score_data: JSON.stringify({
          team_id: { value: team.id },
          round: { value: 1 },
          grand_total: { value: 150 },
        }),
        event_id: event.id,
        score_type: 'seeding',
        status: 'pending',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/${score.id}/accept-event`,
        { force: true },
      );
      expect(res.status).toBe(200);

      // Verify score was overridden
      const seedingScore = await testDb.db.get(
        'SELECT * FROM seeding_scores WHERE team_id = ? AND round_number = ?',
        [team.id, 1],
      );
      expect(seedingScore.score).toBe(150);
    });

    it('accepts DB-backed seeding score (spreadsheet_config_id null)', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 5,
      });
      const template = await seedScoresheetTemplate(testDb.db);

      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: null,
        score_data: JSON.stringify({
          team_id: { value: team.id },
          round: { value: 1 },
          grand_total: { value: 175 },
        }),
        event_id: event.id,
        score_type: 'seeding',
        status: 'pending',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/${score.id}/accept-event`,
      );
      expect(res.status).toBe(200);
      const data = res.json as { success: boolean; scoreType: string };
      expect(data.success).toBe(true);
      expect(data.scoreType).toBe('seeding');

      const seedingScore = await testDb.db.get(
        'SELECT * FROM seeding_scores WHERE team_id = ? AND round_number = ?',
        [team.id, 1],
      );
      expect(seedingScore).toBeDefined();
      expect(seedingScore.score).toBe(175);
    });

    it('returns 400 when seeding score missing team_id', async () => {
      const event = await seedEvent(testDb.db);
      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: null,
        score_data: JSON.stringify({
          round: { value: 1 },
          grand_total: { value: 100 },
        }),
        event_id: event.id,
        score_type: 'seeding',
        status: 'pending',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/${score.id}/accept-event`,
      );
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('team_id');
    });

    it('returns 400 when seeding score missing round_number', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: null,
        score_data: JSON.stringify({
          team_id: { value: team.id },
          grand_total: { value: 100 },
        }),
        event_id: event.id,
        score_type: 'seeding',
        status: 'pending',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/${score.id}/accept-event`,
      );
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('round_number');
    });
  });

  // ==========================================================================
  // POST /scores/event/:eventId/accept/bulk
  // ==========================================================================

  describe('POST /scores/event/:eventId/accept/bulk', () => {
    let server: TestServerHandle;
    let adminUser: { id: number };

    beforeEach(async () => {
      adminUser = await seedUser(testDb.db, { is_admin: true });
      const app = createTestApp({ user: { id: adminUser.id, is_admin: true } });
      app.use('/scores', scoresRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 400 when score_ids is empty', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.post(
        `${server.baseUrl}/scores/event/${event.id}/accept/bulk`,
        { score_ids: [] },
      );
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'score_ids array is required',
      );
    });

    it('returns 400 when event does not exist', async () => {
      const res = await http.post(
        `${server.baseUrl}/scores/event/999/accept/bulk`,
        { score_ids: [1] },
      );
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'Event does not exist',
      );
    });

    it('bulk accepts multiple seeding scores in single transaction', async () => {
      const event = await seedEvent(testDb.db);
      const team1 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const team2 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 2,
      });
      const config = await seedSpreadsheetConfig(testDb.db, {
        user_id: adminUser.id,
      });
      const template = await seedScoresheetTemplate(testDb.db);

      const score1 = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: config.id,
        score_data: JSON.stringify({
          team_id: { value: team1.id },
          round: { value: 1 },
          grand_total: { value: 100 },
        }),
        event_id: event.id,
        score_type: 'seeding',
        status: 'pending',
      });
      const score2 = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: config.id,
        score_data: JSON.stringify({
          team_id: { value: team2.id },
          round: { value: 1 },
          grand_total: { value: 200 },
        }),
        event_id: event.id,
        score_type: 'seeding',
        status: 'pending',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/event/${event.id}/accept/bulk`,
        { score_ids: [score1.id, score2.id] },
      );

      expect(res.status).toBe(200);
      const data = res.json as {
        accepted: number;
        accepted_ids: number[];
        skipped?: { id: number; reason: string }[];
      };
      expect(data.accepted).toBe(2);
      expect(data.accepted_ids).toContain(score1.id);
      expect(data.accepted_ids).toContain(score2.id);

      const seeding1 = await testDb.db.get(
        'SELECT * FROM seeding_scores WHERE team_id = ? AND round_number = ?',
        [team1.id, 1],
      );
      const seeding2 = await testDb.db.get(
        'SELECT * FROM seeding_scores WHERE team_id = ? AND round_number = ?',
        [team2.id, 1],
      );
      expect(seeding1).toBeDefined();
      expect(seeding1.score).toBe(100);
      expect(seeding2).toBeDefined();
      expect(seeding2.score).toBe(200);

      const auditBulk = await testDb.db.all(
        'SELECT * FROM audit_log WHERE event_id = ? AND action = ?',
        [event.id, 'scores_bulk_accepted'],
      );
      expect(auditBulk.length).toBe(1);
    });

    it('skips scores with conflicts and reports them', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const config = await seedSpreadsheetConfig(testDb.db, {
        user_id: adminUser.id,
      });
      const template = await seedScoresheetTemplate(testDb.db);

      // Existing seeding score for team/round
      await testDb.db.run(
        'INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, ?, ?)',
        [team.id, 1, 50],
      );

      const scoreConflict = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: config.id,
        score_data: JSON.stringify({
          team_id: { value: team.id },
          round: { value: 1 },
          grand_total: { value: 150 },
        }),
        event_id: event.id,
        score_type: 'seeding',
        status: 'pending',
      });

      const team2 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 2,
      });
      const scoreOk = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: config.id,
        score_data: JSON.stringify({
          team_id: { value: team2.id },
          round: { value: 1 },
          grand_total: { value: 200 },
        }),
        event_id: event.id,
        score_type: 'seeding',
        status: 'pending',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/event/${event.id}/accept/bulk`,
        { score_ids: [scoreConflict.id, scoreOk.id] },
      );

      expect(res.status).toBe(200);
      const data = res.json as {
        accepted: number;
        accepted_ids: number[];
        skipped?: { id: number; reason: string }[];
      };
      expect(data.accepted).toBe(1);
      expect(data.accepted_ids).toContain(scoreOk.id);
      expect(data.skipped).toBeDefined();
      expect(data.skipped!.length).toBe(1);
      expect(data.skipped![0].id).toBe(scoreConflict.id);
      expect(data.skipped![0].reason).toContain('already exists');

      // Original score unchanged
      const existing = await testDb.db.get(
        'SELECT * FROM seeding_scores WHERE team_id = ? AND round_number = ?',
        [team.id, 1],
      );
      expect(existing.score).toBe(50);

      // New score accepted
      const newSeeding = await testDb.db.get(
        'SELECT * FROM seeding_scores WHERE team_id = ? AND round_number = ?',
        [team2.id, 1],
      );
      expect(newSeeding).toBeDefined();
      expect(newSeeding.score).toBe(200);
    });

    it('ignores scores not in event or not pending', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const config = await seedSpreadsheetConfig(testDb.db, {
        user_id: adminUser.id,
      });
      const template = await seedScoresheetTemplate(testDb.db);

      const scorePending = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: config.id,
        score_data: JSON.stringify({
          team_id: { value: team.id },
          round: { value: 1 },
          grand_total: { value: 100 },
        }),
        event_id: event.id,
        score_type: 'seeding',
        status: 'pending',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/event/${event.id}/accept/bulk`,
        { score_ids: [scorePending.id, 99999] },
      );

      expect(res.status).toBe(200);
      const data = res.json as { accepted: number; accepted_ids: number[] };
      expect(data.accepted).toBe(1);
      expect(data.accepted_ids).toEqual([scorePending.id]);
    });
  });

  // ==========================================================================
  // POST /scores/:id/revert-event
  // ==========================================================================

  describe('POST /scores/:id/revert-event', () => {
    let server: TestServerHandle;
    let adminUser: { id: number };

    beforeEach(async () => {
      adminUser = await seedUser(testDb.db, { is_admin: true });
      const app = createTestApp({ user: { id: adminUser.id, is_admin: true } });
      app.use('/scores', scoresRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 404 when score not found', async () => {
      const res = await http.post(`${server.baseUrl}/scores/999/revert-event`);
      expect(res.status).toBe(404);
    });

    it('returns 400 when score is not accepted', async () => {
      const event = await seedEvent(testDb.db);
      const config = await seedSpreadsheetConfig(testDb.db, {
        user_id: adminUser.id,
      });
      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: config.id,
        score_data: JSON.stringify({}),
        event_id: event.id,
        score_type: 'seeding',
        status: 'pending',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/${score.id}/revert-event`,
      );
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'Only accepted scores',
      );
    });

    it('reverts seeding score and clears seeding_score record', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const config = await seedSpreadsheetConfig(testDb.db, {
        user_id: adminUser.id,
      });
      const template = await seedScoresheetTemplate(testDb.db);

      // Create seeding score
      const seedingScoreResult = await testDb.db.run(
        'INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, ?, ?)',
        [team.id, 1, 150],
      );

      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: config.id,
        score_data: JSON.stringify({
          team_id: { value: team.id },
          round: { value: 1 },
        }),
        event_id: event.id,
        score_type: 'seeding',
        seeding_score_id: seedingScoreResult.lastID,
        status: 'accepted',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/${score.id}/revert-event`,
        { confirm: true },
      );
      expect(res.status).toBe(200);
      const data = res.json as { success: boolean };
      expect(data.success).toBe(true);

      // Verify seeding_score was deleted
      const seedingScore = await testDb.db.get(
        'SELECT * FROM seeding_scores WHERE team_id = ? AND round_number = ?',
        [team.id, 1],
      );
      expect(seedingScore).toBeUndefined();

      // Verify submission status was reverted
      const submission = await testDb.db.get(
        'SELECT * FROM score_submissions WHERE id = ?',
        [score.id],
      );
      expect(submission.status).toBe('pending');

      const scoreRevertedLogs = await testDb.db.all(
        'SELECT * FROM audit_log WHERE event_id = ? AND action = ? AND entity_type = ? AND entity_id = ?',
        [event.id, 'score_reverted', 'score_submission', score.id],
      );
      expect(scoreRevertedLogs.length).toBe(1);

      const seedingClearedLogs = await testDb.db.all(
        'SELECT * FROM audit_log WHERE event_id = ? AND action = ? AND entity_type = ? AND entity_id = ?',
        [
          event.id,
          'seeding_score_cleared',
          'seeding_score',
          seedingScoreResult.lastID,
        ],
      );
      expect(seedingClearedLogs.length).toBe(1);
    });

    it('reverts seeding score and returns matching queue item to queued', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 1,
        seeding_team_id: team.id,
        seeding_round: 1,
        status: 'completed',
      });
      const config = await seedSpreadsheetConfig(testDb.db, {
        user_id: adminUser.id,
      });
      const template = await seedScoresheetTemplate(testDb.db);

      const seedingScoreResult = await testDb.db.run(
        'INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, ?, ?)',
        [team.id, 1, 150],
      );

      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: config.id,
        score_data: JSON.stringify({
          team_id: { value: team.id },
          round: { value: 1 },
        }),
        event_id: event.id,
        score_type: 'seeding',
        seeding_score_id: seedingScoreResult.lastID,
        status: 'accepted',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/${score.id}/revert-event`,
        { confirm: true },
      );
      expect(res.status).toBe(200);

      const queueItem = await testDb.db.get(
        'SELECT * FROM game_queue WHERE event_id = ? AND seeding_team_id = ? AND seeding_round = ?',
        [event.id, team.id, 1],
      );
      expect(queueItem).toBeDefined();
      expect(queueItem.status).toBe('queued');
    });

    it('reverts DB-backed seeding score (spreadsheet_config_id null)', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const template = await seedScoresheetTemplate(testDb.db);

      const seedingScoreResult = await testDb.db.run(
        'INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, ?, ?)',
        [team.id, 1, 120],
      );

      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: null,
        score_data: JSON.stringify({
          team_id: { value: team.id },
          round: { value: 1 },
        }),
        event_id: event.id,
        score_type: 'seeding',
        seeding_score_id: seedingScoreResult.lastID,
        status: 'accepted',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/${score.id}/revert-event`,
        { confirm: true },
      );
      expect(res.status).toBe(200);
      const data = res.json as { success: boolean };
      expect(data.success).toBe(true);

      const seedingScore = await testDb.db.get(
        'SELECT * FROM seeding_scores WHERE team_id = ? AND round_number = ?',
        [team.id, 1],
      );
      expect(seedingScore).toBeUndefined();

      const submission = await testDb.db.get(
        'SELECT * FROM score_submissions WHERE id = ?',
        [score.id],
      );
      expect(submission.status).toBe('pending');

      const scoreRevertedLogs = await testDb.db.all(
        'SELECT * FROM audit_log WHERE event_id = ? AND action = ? AND entity_type = ? AND entity_id = ?',
        [event.id, 'score_reverted', 'score_submission', score.id],
      );
      expect(scoreRevertedLogs.length).toBe(1);

      const seedingClearedLogs = await testDb.db.all(
        'SELECT * FROM audit_log WHERE event_id = ? AND action = ? AND entity_type = ? AND entity_id = ?',
        [
          event.id,
          'seeding_score_cleared',
          'seeding_score',
          seedingScoreResult.lastID,
        ],
      );
      expect(seedingClearedLogs.length).toBe(1);
    });

    it('does dry-run for bracket cascade detection', async () => {
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

      // Create game 1 (completed) and game 2 (pending, receives winner from game 1)
      const game2 = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 2,
        status: 'pending',
      });

      // Insert game 1 with winner advancement
      await testDb.db.run(
        `INSERT INTO bracket_games (bracket_id, game_number, round_name, round_number, team1_id, team2_id, winner_id, status, winner_advances_to_id, winner_slot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bracket.id,
          1,
          'Round 1',
          1,
          team1.id,
          team2.id,
          team1.id,
          'completed',
          game2.id,
          'team1',
        ],
      );
      const game1 = await testDb.db.get(
        'SELECT id FROM bracket_games WHERE bracket_id = ? AND game_number = 1',
        [bracket.id],
      );

      // Update game 2 to have team1 (the winner) in team1 slot
      await testDb.db.run(
        'UPDATE bracket_games SET team1_id = ? WHERE id = ?',
        [team1.id, game2.id],
      );

      const config = await seedSpreadsheetConfig(testDb.db, {
        user_id: adminUser.id,
      });
      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: config.id,
        score_data: JSON.stringify({
          winner_team_id: { value: team1.id },
        }),
        event_id: event.id,
        score_type: 'bracket',
        bracket_game_id: game1.id,
        status: 'accepted',
      });

      // Do dry run
      const res = await http.post(
        `${server.baseUrl}/scores/${score.id}/revert-event`,
        { dryRun: true },
      );
      expect(res.status).toBe(200);
      const data = res.json as {
        requiresConfirmation: boolean;
        affectedGames: { id: number; game_number: number }[];
      };
      expect(data.requiresConfirmation).toBe(true);
      expect(data.affectedGames.length).toBeGreaterThan(0);
    });

    it('reverts bracket score and returns matching queue item to queued', async () => {
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
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'bracket',
        queue_position: 1,
        bracket_game_id: game.id,
        status: 'completed',
      });
      const config = await seedSpreadsheetConfig(testDb.db, {
        user_id: adminUser.id,
      });
      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        spreadsheet_config_id: config.id,
        score_data: JSON.stringify({
          winner_team_id: { value: team1.id },
        }),
        event_id: event.id,
        score_type: 'bracket',
        bracket_game_id: game.id,
        status: 'accepted',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/${score.id}/revert-event`,
        { confirm: true },
      );
      expect(res.status).toBe(200);

      const queueItem = await testDb.db.get(
        'SELECT * FROM game_queue WHERE event_id = ? AND bracket_game_id = ?',
        [event.id, game.id],
      );
      expect(queueItem).toBeDefined();
      expect(queueItem.status).toBe('queued');
    });
  });
});
