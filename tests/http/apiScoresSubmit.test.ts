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
  seedEventScoresheetTemplate,
  seedQueueItem,
  seedUser,
  seedScoreSubmission,
} from './helpers/seed';
import apiRoutes from '../../src/server/routes/api';
import scoresRoutes from '../../src/server/routes/scores';
import { JUDGE_SESSION_TTL_MS } from '../../src/server/middleware/auth';
import { calculateBracketRankings } from '../../src/server/services/bracketRankings';
import { resetAllRateLimiters } from '../../src/server/middleware/rateLimit';

describe('API Score Submit Routes', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;

  beforeEach(async () => {
    // Create fresh in-memory DB with schema
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
    resetAllRateLimiters();

    // Use admin auth so validation/business-logic tests bypass judge session
    const app = createTestApp({ user: { id: 1, is_admin: true } });
    app.use('/api', apiRoutes);
    app.use('/scores', scoresRoutes);

    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
    resetAllRateLimiters();
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

      it('returns 400 when team_id belongs to different event (cross-event isolation)', async () => {
        const eventA = await seedEvent(testDb.db);
        const eventB = await seedEvent(testDb.db);
        const teamInB = await seedTeam(testDb.db, {
          event_id: eventB.id,
          team_number: 1,
          team_name: 'Team in Event B',
        });
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'DB Template',
          created_by: null,
          spreadsheet_config_id: null,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: {
            team_id: { value: teamInB.id, type: 'number' },
            round: { value: 1, type: 'number' },
            grand_total: { value: 100, type: 'calculated' },
          },
          eventId: eventA.id,
          scoreType: 'seeding',
        });

        expect(res.status).toBe(400);
        expect((res.json as { error: string }).error).toContain(
          'does not belong to this event',
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

      it('marks matching seeding queue item score submitted immediately on submit', async () => {
        const event = await seedEvent(testDb.db);
        const team = await seedTeam(testDb.db, {
          event_id: event.id,
          team_number: 88,
          team_name: 'Submit Queue Team',
        });
        await seedQueueItem(testDb.db, {
          event_id: event.id,
          queue_type: 'seeding',
          queue_position: 1,
          seeding_team_id: team.id,
          seeding_round: 1,
          status: 'queued',
        });
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'DB Seeding Template',
          created_by: null,
          spreadsheet_config_id: null,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          participantName: 'Submit Queue Team',
          scoreData: {
            team_id: { value: team.id, type: 'number' },
            round: { value: 1, type: 'number' },
            grand_total: { value: 123, type: 'calculated' },
          },
          eventId: event.id,
          scoreType: 'seeding',
        });

        expect(res.status).toBe(200);

        const queueItem = await testDb.db.get(
          `SELECT status FROM game_queue
           WHERE event_id = ? AND queue_type = 'seeding' AND seeding_team_id = ? AND seeding_round = ?`,
          [event.id, team.id, 1],
        );
        expect(queueItem).toBeDefined();
        expect(queueItem.status).toBe('score_submitted');
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

      it('marks matching bracket queue item score submitted immediately on submit', async () => {
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
        await seedQueueItem(testDb.db, {
          event_id: event.id,
          queue_type: 'bracket',
          queue_position: 1,
          bracket_game_id: game.id,
          status: 'called',
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

        const queueItem = await testDb.db.get(
          `SELECT status FROM game_queue
           WHERE event_id = ? AND queue_type = 'bracket' AND bracket_game_id = ?`,
          [event.id, game.id],
        );
        expect(queueItem).toBeDefined();
        expect(queueItem.status).toBe('score_submitted');
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

      // ==========================================================================
      // Auto-Accept
      // ==========================================================================

      describe('Auto-Accept', () => {
        it('auto-accepts seeding score when event has auto_accept_seeding', async () => {
          const event = await seedEvent(testDb.db, {
            score_accept_mode: 'auto_accept_seeding',
          });
          const team = await seedTeam(testDb.db, {
            event_id: event.id,
            team_number: 1,
            team_name: 'Auto Team',
          });
          const template = await seedScoresheetTemplate(testDb.db, {
            name: 'DB Seeding Template',
            created_by: null,
            spreadsheet_config_id: null,
          });

          const res = await http.post(`${baseUrl}/api/scores/submit`, {
            templateId: template.id,
            scoreData: {
              team_id: { value: team.id, type: 'number' },
              round: { value: 1, type: 'number' },
              grand_total: { value: 200, type: 'calculated' },
            },
            eventId: event.id,
            scoreType: 'seeding',
          });

          expect(res.status).toBe(200);
          const submission = res.json as {
            status: string;
            reviewed_by: number | null;
          };
          expect(submission.status).toBe('accepted');
          expect(submission.reviewed_by).toBeNull();

          const auditLogs = await testDb.db.all(
            'SELECT action FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY created_at',
            ['score_submission', submission.id],
          );
          const actions = auditLogs.map((r: { action: string }) => r.action);
          expect(actions).toContain('score_submitted');
          expect(actions).toContain('score_auto_accepted');

          const ranking = await testDb.db.get<{
            seed_rank: number | null;
            seed_average: number | null;
          }>(
            'SELECT seed_rank, seed_average FROM seeding_rankings WHERE team_id = ?',
            [team.id],
          );
          expect(ranking).toBeDefined();
          expect(ranking?.seed_rank).toBe(1);
          expect(ranking?.seed_average).toBe(200);
        });

        it('allows reverting auto-accepted seeding score via revert-event', async () => {
          const event = await seedEvent(testDb.db, {
            score_accept_mode: 'auto_accept_seeding',
          });
          const team = await seedTeam(testDb.db, {
            event_id: event.id,
            team_number: 1,
            team_name: 'Revert Team',
          });
          const template = await seedScoresheetTemplate(testDb.db, {
            name: 'DB Seeding Template',
            created_by: null,
            spreadsheet_config_id: null,
          });

          const submitRes = await http.post(`${baseUrl}/api/scores/submit`, {
            templateId: template.id,
            scoreData: {
              team_id: { value: team.id, type: 'number' },
              round: { value: 1, type: 'number' },
              grand_total: { value: 200, type: 'calculated' },
            },
            eventId: event.id,
            scoreType: 'seeding',
          });

          expect(submitRes.status).toBe(200);
          const submission = submitRes.json as {
            id: number;
            status: string;
            reviewed_by: number | null;
          };
          expect(submission.status).toBe('accepted');
          expect(submission.reviewed_by).toBeNull();

          const revertRes = await http.post(
            `${baseUrl}/scores/${submission.id}/revert-event`,
            { confirm: true },
          );
          expect(revertRes.status).toBe(200);

          const updated = await testDb.db.get(
            'SELECT * FROM score_submissions WHERE id = ?',
            [submission.id],
          );
          expect(updated?.status).toBe('pending');
          expect(updated?.reviewed_by).toBeNull();
          expect(updated?.seeding_score_id).toBeNull();

          const seedingScore = await testDb.db.get(
            'SELECT * FROM seeding_scores WHERE team_id = ? AND round_number = ?',
            [team.id, 1],
          );
          expect(seedingScore).toBeUndefined();
        });

        it('leaves bracket score pending when event has auto_accept_seeding only', async () => {
          const event = await seedEvent(testDb.db, {
            score_accept_mode: 'auto_accept_seeding',
          });
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
            eventId: event.id,
            scoreType: 'bracket',
            bracket_game_id: game.id,
          });

          expect(res.status).toBe(200);
          const submission = res.json as { status: string };
          expect(submission.status).toBe('pending');
        });

        it('auto-accepts all scores when event has auto_accept_all', async () => {
          const event = await seedEvent(testDb.db, {
            score_accept_mode: 'auto_accept_all',
          });
          const team = await seedTeam(testDb.db, {
            event_id: event.id,
            team_number: 1,
            team_name: 'Team One',
          });
          const template = await seedScoresheetTemplate(testDb.db, {
            name: 'DB Seeding Template',
            created_by: null,
            spreadsheet_config_id: null,
          });

          const res = await http.post(`${baseUrl}/api/scores/submit`, {
            templateId: template.id,
            scoreData: {
              team_id: { value: team.id, type: 'number' },
              round: { value: 1, type: 'number' },
              grand_total: { value: 150, type: 'calculated' },
            },
            eventId: event.id,
            scoreType: 'seeding',
          });

          expect(res.status).toBe(200);
          const submission = res.json as {
            status: string;
            reviewed_by: number | null;
          };
          expect(submission.status).toBe('accepted');
          expect(submission.reviewed_by).toBeNull();
        });

        it('accepts scores from two brackets through one template and keeps rankings bracket-scoped', async () => {
          const event = await seedEvent(testDb.db, {
            score_accept_mode: 'auto_accept_all',
          });
          const template = await seedScoresheetTemplate(testDb.db, {
            name: 'Event-Wide Bracket Template',
            created_by: null,
            spreadsheet_config_id: null,
          });

          const bracketA = await seedBracket(testDb.db, {
            event_id: event.id,
            name: 'Alpha',
            bracket_size: 4,
          });
          const alpha1 = await seedTeam(testDb.db, {
            event_id: event.id,
            team_number: 11,
            team_name: 'Alpha One',
          });
          const alpha2 = await seedTeam(testDb.db, {
            event_id: event.id,
            team_number: 12,
            team_name: 'Alpha Two',
          });
          const alpha3 = await seedTeam(testDb.db, {
            event_id: event.id,
            team_number: 13,
            team_name: 'Alpha Three',
          });
          await testDb.db.run(
            `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye)
             VALUES (?, ?, 1, 0), (?, ?, 2, 0), (?, ?, 3, 0)`,
            [
              bracketA.id,
              alpha1.id,
              bracketA.id,
              alpha2.id,
              bracketA.id,
              alpha3.id,
            ],
          );
          const alphaFinal = await seedBracketGame(testDb.db, {
            bracket_id: bracketA.id,
            game_number: 2,
            round_name: 'Final',
            round_number: 2,
            bracket_side: 'finals',
            team1_id: alpha3.id,
            status: 'pending',
          });
          const alphaSemi = await seedBracketGame(testDb.db, {
            bracket_id: bracketA.id,
            game_number: 1,
            round_name: 'Semi',
            round_number: 1,
            bracket_side: 'winners',
            team1_id: alpha1.id,
            team2_id: alpha2.id,
            status: 'ready',
          });
          await testDb.db.run(
            `UPDATE bracket_games
             SET winner_advances_to_id = ?, winner_slot = 'team2'
             WHERE id = ?`,
            [alphaFinal.id, alphaSemi.id],
          );

          const bracketB = await seedBracket(testDb.db, {
            event_id: event.id,
            name: 'Beta',
            bracket_size: 2,
          });
          const beta1 = await seedTeam(testDb.db, {
            event_id: event.id,
            team_number: 21,
            team_name: 'Beta One',
          });
          const beta2 = await seedTeam(testDb.db, {
            event_id: event.id,
            team_number: 22,
            team_name: 'Beta Two',
          });
          await testDb.db.run(
            `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye)
             VALUES (?, ?, 1, 0), (?, ?, 2, 0)`,
            [bracketB.id, beta1.id, bracketB.id, beta2.id],
          );
          await testDb.db.run(
            `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank)
             VALUES (?, ?, ?), (?, ?, ?)`,
            [beta1.id, 100, 1, beta2.id, 90, 2],
          );
          const betaFinal = await seedBracketGame(testDb.db, {
            bracket_id: bracketB.id,
            game_number: 1,
            round_name: 'Final',
            round_number: 1,
            bracket_side: 'finals',
            team1_id: beta1.id,
            team2_id: beta2.id,
            status: 'ready',
          });

          const alphaSubmit = await http.post(`${baseUrl}/api/scores/submit`, {
            templateId: template.id,
            participantName: '11 - Alpha One',
            matchId: '1',
            scoreData: {
              winner_team_id: { value: alpha1.id, type: 'number' },
              team1_score: { value: 140, type: 'number' },
              team2_score: { value: 120, type: 'number' },
            },
            isHeadToHead: true,
            eventId: event.id,
            scoreType: 'bracket',
            bracket_game_id: alphaSemi.id,
          });
          expect(alphaSubmit.status).toBe(200);

          const betaSubmit = await http.post(`${baseUrl}/api/scores/submit`, {
            templateId: template.id,
            participantName: '22 - Beta Two',
            matchId: '1',
            scoreData: {
              winner_team_id: { value: beta2.id, type: 'number' },
              team1_score: { value: 95, type: 'number' },
              team2_score: { value: 110, type: 'number' },
            },
            isHeadToHead: true,
            eventId: event.id,
            scoreType: 'bracket',
            bracket_game_id: betaFinal.id,
          });
          expect(betaSubmit.status).toBe(200);

          const updatedAlphaSemi = await testDb.db.get(
            'SELECT winner_id, status, score_submission_id FROM bracket_games WHERE id = ?',
            [alphaSemi.id],
          );
          expect(updatedAlphaSemi?.winner_id).toBe(alpha1.id);
          expect(updatedAlphaSemi?.status).toBe('completed');

          const updatedAlphaFinal = await testDb.db.get(
            'SELECT team1_id, team2_id, status FROM bracket_games WHERE id = ?',
            [alphaFinal.id],
          );
          expect(updatedAlphaFinal?.team1_id).toBe(alpha3.id);
          expect(updatedAlphaFinal?.team2_id).toBe(alpha1.id);
          expect(updatedAlphaFinal?.status).toBe('ready');

          const updatedBetaFinal = await testDb.db.get(
            'SELECT winner_id, loser_id, status FROM bracket_games WHERE id = ?',
            [betaFinal.id],
          );
          expect(updatedBetaFinal?.winner_id).toBe(beta2.id);
          expect(updatedBetaFinal?.loser_id).toBe(beta1.id);
          expect(updatedBetaFinal?.status).toBe('completed');

          const betaRankings = await calculateBracketRankings(bracketB.id);
          expect(betaRankings.teamsRanked).toBe(2);

          const betaEntries = await testDb.db.all(
            `SELECT team_id, final_rank
             FROM bracket_entries
             WHERE bracket_id = ?
             ORDER BY final_rank ASC`,
            [bracketB.id],
          );
          expect(betaEntries).toEqual([
            { team_id: beta2.id, final_rank: 1 },
            { team_id: beta1.id, final_rank: 2 },
          ]);

          const alphaRanks = await testDb.db.all(
            'SELECT team_id, final_rank FROM bracket_entries WHERE bracket_id = ? ORDER BY seed_position ASC',
            [bracketA.id],
          );
          expect(
            alphaRanks.every(
              (entry: { final_rank: number | null }) =>
                entry.final_rank == null,
            ),
          ).toBe(true);
        });

        it('allows reverting auto-accepted bracket score via revert-event', async () => {
          const event = await seedEvent(testDb.db, {
            score_accept_mode: 'auto_accept_all',
          });
          const team1 = await seedTeam(testDb.db, {
            event_id: event.id,
            team_number: 1,
            team_name: 'Winner',
          });
          const team2 = await seedTeam(testDb.db, {
            event_id: event.id,
            team_number: 2,
            team_name: 'Loser',
          });
          const bracket = await seedBracket(testDb.db, {
            event_id: event.id,
            name: 'Main',
            bracket_size: 4,
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

          const submitRes = await http.post(`${baseUrl}/api/scores/submit`, {
            templateId: template.id,
            scoreData: {
              winner_team_id: { value: team1.id, type: 'number' },
              team1_score: { value: 100, type: 'number' },
              team2_score: { value: 80, type: 'number' },
            },
            eventId: event.id,
            scoreType: 'bracket',
            bracket_game_id: game.id,
          });

          expect(submitRes.status).toBe(200);
          const submission = submitRes.json as {
            id: number;
            status: string;
            reviewed_by: number | null;
          };
          expect(submission.status).toBe('accepted');
          expect(submission.reviewed_by).toBeNull();

          const revertRes = await http.post(
            `${baseUrl}/scores/${submission.id}/revert-event`,
            { confirm: true },
          );
          expect(revertRes.status).toBe(200);

          const updated = await testDb.db.get(
            'SELECT * FROM score_submissions WHERE id = ?',
            [submission.id],
          );
          expect(updated?.status).toBe('pending');
          expect(updated?.reviewed_by).toBeNull();

          const bracketGame = await testDb.db.get(
            'SELECT winner_id, status FROM bracket_games WHERE id = ?',
            [game.id],
          );
          expect(bracketGame?.winner_id).toBeNull();
          expect(bracketGame?.status).not.toBe('completed');
        });

        it('leaves score pending when auto-accept hits conflict (force=false)', async () => {
          const event = await seedEvent(testDb.db, {
            score_accept_mode: 'auto_accept_seeding',
          });
          const team = await seedTeam(testDb.db, {
            event_id: event.id,
            team_number: 1,
            team_name: 'Conflict Team',
          });
          const template = await seedScoresheetTemplate(testDb.db, {
            name: 'DB Seeding Template',
            created_by: null,
            spreadsheet_config_id: null,
          });

          await testDb.db.run(
            `INSERT INTO seeding_scores (team_id, round_number, score, scored_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
            [team.id, 1, 99],
          );

          const res = await http.post(`${baseUrl}/api/scores/submit`, {
            templateId: template.id,
            scoreData: {
              team_id: { value: team.id, type: 'number' },
              round: { value: 1, type: 'number' },
              grand_total: { value: 200, type: 'calculated' },
            },
            eventId: event.id,
            scoreType: 'seeding',
          });

          expect(res.status).toBe(200);
          const submission = res.json as { status: string };
          expect(submission.status).toBe('pending');
        });

        it('leaves score pending when event has manual mode', async () => {
          const event = await seedEvent(testDb.db, {
            score_accept_mode: 'manual',
          });
          const team = await seedTeam(testDb.db, {
            event_id: event.id,
            team_number: 1,
            team_name: 'Manual Team',
          });
          const template = await seedScoresheetTemplate(testDb.db, {
            name: 'DB Seeding Template',
            created_by: null,
            spreadsheet_config_id: null,
          });

          const res = await http.post(`${baseUrl}/api/scores/submit`, {
            templateId: template.id,
            scoreData: {
              team_id: { value: team.id, type: 'number' },
              round: { value: 1, type: 'number' },
              grand_total: { value: 100, type: 'calculated' },
            },
            eventId: event.id,
            scoreType: 'seeding',
          });

          expect(res.status).toBe(200);
          const submission = res.json as { status: string };
          expect(submission.status).toBe('pending');
        });
      });
    });
  });

  // ==========================================================================
  // Judge Session Enforcement
  // ==========================================================================

  describe('Judge Session Enforcement', () => {
    it('returns 401 when no judge session and no admin auth', async () => {
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Auth Template',
        created_by: null,
        spreadsheet_config_id: null,
      });
      const event = await seedEvent(testDb.db);

      const app = createTestApp();
      app.use('/api', apiRoutes);
      const srv = await startServer(app);

      try {
        const res = await http.post(`${srv.baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: { points: 100 },
          eventId: event.id,
          scoreType: 'seeding',
        });

        expect(res.status).toBe(401);
        expect((res.json as { error: string }).error).toContain(
          'Judge session required',
        );
      } finally {
        await srv.close();
      }
    });

    it('returns 401 when judge session is expired', async () => {
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Expired Template',
        created_by: null,
        spreadsheet_config_id: null,
      });
      const event = await seedEvent(testDb.db);

      const app = createTestApp({
        judgeSession: {
          templateId: template.id,
          eventIds: [event.id],
          issuedAt: Date.now() - JUDGE_SESSION_TTL_MS - 60_000,
          expiresAt: Date.now() - 60_000,
        },
      });
      app.use('/api', apiRoutes);
      const srv = await startServer(app);

      try {
        const res = await http.post(`${srv.baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: { points: 100 },
          eventId: event.id,
          scoreType: 'seeding',
        });

        expect(res.status).toBe(401);
        expect((res.json as { error: string }).error).toContain(
          'session expired',
        );
      } finally {
        await srv.close();
      }
    });

    it('returns 403 when judge session templateId does not match', async () => {
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Mismatch Template',
        created_by: null,
        spreadsheet_config_id: null,
      });
      const event = await seedEvent(testDb.db);

      const app = createTestApp({
        judgeSession: {
          templateId: template.id + 999,
          eventIds: [event.id],
          issuedAt: Date.now(),
          expiresAt: Date.now() + JUDGE_SESSION_TTL_MS,
        },
      });
      app.use('/api', apiRoutes);
      const srv = await startServer(app);

      try {
        const res = await http.post(`${srv.baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: { points: 100 },
          eventId: event.id,
          scoreType: 'seeding',
        });

        expect(res.status).toBe(403);
        expect((res.json as { error: string }).error).toContain(
          'does not match the requested template',
        );
      } finally {
        await srv.close();
      }
    });

    it('returns 403 when judge session eventId does not match', async () => {
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Event Mismatch Template',
        created_by: null,
        spreadsheet_config_id: null,
      });
      const eventA = await seedEvent(testDb.db);
      const eventB = await seedEvent(testDb.db);

      const app = createTestApp({
        judgeSession: {
          templateId: template.id,
          eventIds: [eventB.id],
          issuedAt: Date.now(),
          expiresAt: Date.now() + JUDGE_SESSION_TTL_MS,
        },
      });
      app.use('/api', apiRoutes);
      const srv = await startServer(app);

      try {
        const res = await http.post(`${srv.baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: { points: 100 },
          eventId: eventA.id,
          scoreType: 'seeding',
        });

        expect(res.status).toBe(403);
        expect((res.json as { error: string }).error).toContain(
          'does not match the requested event',
        );
      } finally {
        await srv.close();
      }
    });

    it('allows submission with valid judge session', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 50,
        team_name: 'Judge Team',
      });
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Judge Auth Template',
        created_by: null,
        spreadsheet_config_id: null,
      });

      const app = createTestApp({
        judgeSession: {
          templateId: template.id,
          eventIds: [event.id],
          issuedAt: Date.now(),
          expiresAt: Date.now() + JUDGE_SESSION_TTL_MS,
        },
      });
      app.use('/api', apiRoutes);
      const srv = await startServer(app);

      try {
        const res = await http.post(`${srv.baseUrl}/api/scores/submit`, {
          templateId: template.id,
          participantName: 'Judge Team',
          matchId: '1',
          scoreData: {
            team_id: { value: team.id, type: 'number' },
            round: { value: 1, type: 'number' },
            grand_total: { value: 100, type: 'calculated' },
          },
          eventId: event.id,
          scoreType: 'seeding',
        });

        expect(res.status).toBe(200);
        const submission = res.json as { event_id: number; score_type: string };
        expect(submission.event_id).toBe(event.id);
        expect(submission.score_type).toBe('seeding');
      } finally {
        await srv.close();
      }
    });

    it('allows admin user to submit without judge session', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 60,
        team_name: 'Admin Team',
      });
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Admin Submit Template',
        created_by: null,
        spreadsheet_config_id: null,
      });

      const app = createTestApp({ user: { id: 1, is_admin: true } });
      app.use('/api', apiRoutes);
      const srv = await startServer(app);

      try {
        const res = await http.post(`${srv.baseUrl}/api/scores/submit`, {
          templateId: template.id,
          participantName: 'Admin Team',
          matchId: '1',
          scoreData: {
            team_id: { value: team.id, type: 'number' },
            round: { value: 1, type: 'number' },
            grand_total: { value: 100, type: 'calculated' },
          },
          eventId: event.id,
          scoreType: 'seeding',
        });

        expect(res.status).toBe(200);
        const submission = res.json as { event_id: number };
        expect(submission.event_id).toBe(event.id);
      } finally {
        await srv.close();
      }
    });
  });

  // ==========================================================================
  // GET /api/scores/history (requires auth)
  // ==========================================================================

  describe('GET /api/scores/history', () => {
    it('returns 401 when not authenticated', async () => {
      const app = createTestApp();
      app.use('/api', apiRoutes);
      const unauthServer = await startServer(app);

      try {
        const res = await http.get(
          `${unauthServer.baseUrl}/api/scores/history`,
        );
        expect(res.status).toBe(401);
      } finally {
        await unauthServer.close();
      }
    });

    it('returns empty array when user has no score history', async () => {
      const user = await seedUser(testDb.db, { is_admin: false });
      const app = createTestApp({ user: { id: user.id, is_admin: false } });
      app.use('/api', apiRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(`${server.baseUrl}/api/scores/history`);
        expect(res.status).toBe(200);
        expect(res.json).toEqual([]);
      } finally {
        await server.close();
      }
    });

    it('returns user score history with parsed score_data', async () => {
      const user = await seedUser(testDb.db, { is_admin: false });
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'History Template',
        created_by: user.id,
        spreadsheet_config_id: null,
      });
      await seedScoreSubmission(testDb.db, {
        user_id: user.id,
        template_id: template.id,
        score_data: JSON.stringify({ points: 100, round: 1 }),
        participant_name: 'Test',
        match_id: '1',
      });

      const app = createTestApp({ user: { id: user.id, is_admin: false } });
      app.use('/api', apiRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(`${server.baseUrl}/api/scores/history`);
        expect(res.status).toBe(200);
        const scores = res.json as {
          template_name: string;
          score_data: unknown;
        }[];
        expect(scores.length).toBe(1);
        expect(scores[0].template_name).toBe('History Template');
        expect(scores[0].score_data).toEqual({ points: 100, round: 1 });
      } finally {
        await server.close();
      }
    });
  });
});
