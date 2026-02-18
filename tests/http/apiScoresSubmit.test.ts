/**
 * HTTP route tests for POST /api/scores/submit endpoint.
 * Tests validation, template ownership, and spreadsheet config selection logic.
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
  seedTeam,
  seedBracket,
  seedBracketGame,
  seedScoresheetTemplate,
  seedQueueItem,
} from './helpers/seed';
import apiRoutes from '../../src/server/routes/api';

describe('API Score Submit Routes', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;

  beforeEach(async () => {
    // Create fresh in-memory DB with schema
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    // The POST /api/scores/submit endpoint is public (no auth required)
    const app = createTestApp();
    app.use('/api', apiRoutes);

    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  // ==========================================================================
  // POST /api/scores/submit
  // ==========================================================================

  describe('POST /api/scores/submit', () => {
    describe('Validation', () => {
      it('returns 400 when templateId is missing', async () => {
        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          scoreData: { points: 100 },
        });

        expect(res.status).toBe(400);
        expect((res.json as { error: string }).error).toContain(
          'Template ID and score data are required',
        );
      });

      it('returns 400 when scoreData is missing', async () => {
        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: 1,
        });

        expect(res.status).toBe(400);
        expect((res.json as { error: string }).error).toContain(
          'Template ID and score data are required',
        );
      });

      it('returns 400 when both templateId and scoreData are missing', async () => {
        const res = await http.post(`${baseUrl}/api/scores/submit`, {});

        expect(res.status).toBe(400);
        expect((res.json as { error: string }).error).toContain(
          'Template ID and score data are required',
        );
      });
    });

    describe('Template Validation', () => {
      it('returns 400 when template does not exist', async () => {
        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: 999,
          scoreData: { points: 100 },
        });

        expect(res.status).toBe(400);
        expect((res.json as { error: string }).error).toContain(
          'Template not found',
        );
      });

      it('returns 400 when non-event-scoped submission (legacy spreadsheet path removed)', async () => {
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'Legacy Template',
          created_by: null,
          spreadsheet_config_id: null,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: { points: 50 },
          // No eventId, no scoreType - should reject
        });

        expect(res.status).toBe(400);
        expect((res.json as { error: string }).error).toContain(
          'Event-scoped submission is required',
        );
      });
    });

    // ==========================================================================
    // DB-Backed (Event-Scoped) Submission
    // ==========================================================================

    describe('DB-Backed (Event-Scoped) Submission', () => {
      it('creates event-scoped seeding score with team_id (no spreadsheet)', async () => {
        const event = await seedEvent(testDb.db);
        const team = await seedTeam(testDb.db, {
          event_id: event.id,
          team_number: 42,
          team_name: 'Test Team',
        });
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'DB Seeding Template',
          created_by: null,
          spreadsheet_config_id: null,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          participantName: 'Test Team',
          matchId: '1',
          scoreData: {
            team_id: { value: team.id, type: 'number' },
            team_number: { value: 42, type: 'text' },
            team_name: { value: 'Test Team', type: 'text' },
            round: { value: 1, type: 'number' },
            grand_total: { value: 150, type: 'calculated' },
          },
          eventId: event.id,
          scoreType: 'seeding',
        });

        expect(res.status).toBe(200);
        const submission = res.json as {
          id: number;
          spreadsheet_config_id: number | null;
          event_id: number | null;
          score_type: string | null;
          status: string;
        };
        expect(submission.spreadsheet_config_id).toBeNull();
        expect(submission.event_id).toBe(event.id);
        expect(submission.score_type).toBe('seeding');
        expect(submission.status).toBe('pending');

        const scoreData = JSON.parse(
          (res.json as { score_data: string }).score_data,
        );
        expect(scoreData.team_id?.value).toBe(team.id);

        const auditLogs = await testDb.db.all(
          'SELECT * FROM audit_log WHERE event_id = ? AND action = ? AND entity_type = ? AND entity_id = ?',
          [event.id, 'score_submitted', 'score_submission', submission.id],
        );
        expect(auditLogs.length).toBe(1);
        expect(auditLogs[0].event_id).toBe(event.id);
        expect(auditLogs[0].action).toBe('score_submitted');
        expect(auditLogs[0].entity_type).toBe('score_submission');
        expect(auditLogs[0].entity_id).toBe(submission.id);
      });

      it('resolves team_number to team_id when team_id not provided', async () => {
        const event = await seedEvent(testDb.db);
        const team = await seedTeam(testDb.db, {
          event_id: event.id,
          team_number: 7,
          team_name: 'Lucky Seven',
        });
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'DB Seeding Template',
          created_by: null,
          spreadsheet_config_id: null,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          participantName: 'Lucky Seven',
          matchId: '2',
          scoreData: {
            team_number: { value: 7, type: 'text' },
            team_name: { value: 'Lucky Seven', type: 'text' },
            round: { value: 2, type: 'number' },
            grand_total: { value: 200, type: 'calculated' },
          },
          eventId: event.id,
          scoreType: 'seeding',
        });

        expect(res.status).toBe(200);
        const submission = res.json as {
          spreadsheet_config_id: number | null;
          event_id: number | null;
          score_type: string | null;
        };
        expect(submission.spreadsheet_config_id).toBeNull();
        expect(submission.event_id).toBe(event.id);
        expect(submission.score_type).toBe('seeding');

        const scoreData = JSON.parse(
          (res.json as { score_data: string }).score_data,
        );
        expect(scoreData.team_id?.value).toBe(team.id);
      });

      it('returns 400 when event does not exist', async () => {
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'DB Template',
          created_by: null,
          spreadsheet_config_id: null,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: {
            team_id: { value: 1, type: 'number' },
            round: { value: 1, type: 'number' },
            grand_total: { value: 100, type: 'calculated' },
          },
          eventId: 99999,
          scoreType: 'seeding',
        });

        expect(res.status).toBe(400);
        expect((res.json as { error: string }).error).toContain(
          'Invalid event',
        );
      });

      it('returns 400 when team not found for event (team_number)', async () => {
        const event = await seedEvent(testDb.db);
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'DB Template',
          created_by: null,
          spreadsheet_config_id: null,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: {
            team_number: { value: 999, type: 'text' },
            round: { value: 1, type: 'number' },
            grand_total: { value: 100, type: 'calculated' },
          },
          eventId: event.id,
          scoreType: 'seeding',
        });

        expect(res.status).toBe(400);
        expect((res.json as { error: string }).error).toContain(
          'Team not found',
        );
      });

      it('returns 400 when team_id missing and team_number missing', async () => {
        const event = await seedEvent(testDb.db);
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'DB Template',
          created_by: null,
          spreadsheet_config_id: null,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: {
            round: { value: 1, type: 'number' },
            grand_total: { value: 100, type: 'calculated' },
          },
          eventId: event.id,
          scoreType: 'seeding',
        });

        expect(res.status).toBe(400);
        expect((res.json as { error: string }).error).toContain(
          'Team not found',
        );
      });

      it('stores game_queue_id when provided for seeding submission', async () => {
        const event = await seedEvent(testDb.db);
        const team = await seedTeam(testDb.db, {
          event_id: event.id,
          team_number: 99,
          team_name: 'Queue Team',
        });
        const queueItem = await seedQueueItem(testDb.db, {
          event_id: event.id,
          queue_type: 'seeding',
          queue_position: 1,
          seeding_team_id: team.id,
          seeding_round: 2,
        });
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'DB Seeding Template',
          created_by: null,
          spreadsheet_config_id: null,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          participantName: 'Queue Team',
          matchId: '2',
          scoreData: {
            team_id: { value: team.id, type: 'number' },
            team_number: { value: 99, type: 'text' },
            team_name: { value: 'Queue Team', type: 'text' },
            round: { value: 2, type: 'number' },
            grand_total: { value: 180, type: 'calculated' },
          },
          eventId: event.id,
          scoreType: 'seeding',
          game_queue_id: queueItem.id,
        });

        expect(res.status).toBe(200);
        const submission = res.json as {
          game_queue_id: number | null;
          event_id: number | null;
          score_type: string | null;
        };
        expect(submission.game_queue_id).toBe(queueItem.id);
        expect(submission.event_id).toBe(event.id);
        expect(submission.score_type).toBe('seeding');
      });

      it('creates DB-backed bracket score submission with bracket_game_id', async () => {
        const event = await seedEvent(testDb.db);
        const team1 = await seedTeam(testDb.db, {
          event_id: event.id,
          team_number: 1,
          team_name: 'Team A',
        });
        const team2 = await seedTeam(testDb.db, {
          event_id: event.id,
          team_number: 2,
          team_name: 'Team B',
        });
        const bracket = await seedBracket(testDb.db, {
          event_id: event.id,
          name: 'Main Bracket',
          bracket_size: 8,
        });
        const game = await seedBracketGame(testDb.db, {
          bracket_id: bracket.id,
          game_number: 1,
          team1_id: team1.id,
          team2_id: team2.id,
          status: 'ready',
        });
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'DB Bracket Template',
          created_by: null,
          spreadsheet_config_id: null,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          participantName: '1 - Team A',
          matchId: '1',
          scoreData: {
            winner_team_id: { value: team1.id, type: 'number' },
            team1_score: { value: 100, type: 'number' },
            team2_score: { value: 80, type: 'number' },
          },
          isHeadToHead: true,
          eventId: event.id,
          scoreType: 'bracket',
          bracket_game_id: game.id,
        });

        expect(res.status).toBe(200);
        const submission = res.json as {
          id: number;
          spreadsheet_config_id: number | null;
          event_id: number | null;
          score_type: string | null;
          bracket_game_id: number | null;
          status: string;
        };
        expect(submission.spreadsheet_config_id).toBeNull();
        expect(submission.event_id).toBe(event.id);
        expect(submission.score_type).toBe('bracket');
        expect(submission.bracket_game_id).toBe(game.id);
        expect(submission.status).toBe('pending');

        const auditLogs = await testDb.db.all(
          'SELECT * FROM audit_log WHERE event_id = ? AND action = ? AND entity_type = ? AND entity_id = ?',
          [event.id, 'score_submitted', 'score_submission', submission.id],
        );
        expect(auditLogs.length).toBe(1);
      });

      it('returns 400 when bracket_game_id missing for DB-backed bracket submission', async () => {
        const event = await seedEvent(testDb.db);
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'DB Bracket Template',
          created_by: null,
          spreadsheet_config_id: null,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: {
            winner_team_id: { value: 1, type: 'number' },
            team1_score: { value: 100, type: 'number' },
            team2_score: { value: 80, type: 'number' },
          },
          isHeadToHead: true,
          eventId: event.id,
          scoreType: 'bracket',
          // bracket_game_id missing
        });

        expect(res.status).toBe(400);
        expect((res.json as { error: string }).error).toContain(
          'bracket_game_id is required',
        );
      });

      it('returns 400 when bracket game not found or does not belong to event', async () => {
        const event = await seedEvent(testDb.db);
        const team1 = await seedTeam(testDb.db, {
          event_id: event.id,
          team_number: 1,
          team_name: 'Team A',
        });
        const team2 = await seedTeam(testDb.db, {
          event_id: event.id,
          team_number: 2,
          team_name: 'Team B',
        });
        const bracket = await seedBracket(testDb.db, {
          event_id: event.id,
          name: 'Main Bracket',
          bracket_size: 8,
        });
        const game = await seedBracketGame(testDb.db, {
          bracket_id: bracket.id,
          game_number: 1,
          team1_id: team1.id,
          team2_id: team2.id,
          status: 'ready',
        });
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'DB Bracket Template',
          created_by: null,
          spreadsheet_config_id: null,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: {
            winner_team_id: { value: team1.id, type: 'number' },
            team1_score: { value: 100, type: 'number' },
            team2_score: { value: 80, type: 'number' },
          },
          isHeadToHead: true,
          eventId: event.id,
          scoreType: 'bracket',
          bracket_game_id: 99999, // Non-existent game
        });

        expect(res.status).toBe(400);
        expect((res.json as { error: string }).error).toContain(
          'Bracket game not found',
        );
      });

    });
  });
});
