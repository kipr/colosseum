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
  seedUser,
  seedEvent,
  seedTeam,
  seedScoresheetTemplate,
  seedSpreadsheetConfig,
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

      it('returns 400 when template has no owner (created_by is null)', async () => {
        // Create template without owner
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'Orphan Template',
          created_by: null,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: { points: 100 },
        });

        expect(res.status).toBe(400);
        expect((res.json as { error: string }).error).toContain(
          'Template has no owner',
        );
      });
    });

    describe('Spreadsheet Config Selection - Linked Config', () => {
      it('uses linked spreadsheet config when template has spreadsheet_config_id', async () => {
        const user = await seedUser(testDb.db);
        const config = await seedSpreadsheetConfig(testDb.db, {
          user_id: user.id,
          spreadsheet_id: 'linked-sheet',
          sheet_name: 'LinkedSheet',
          sheet_purpose: 'scores',
          is_active: true,
        });
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'Linked Template',
          created_by: user.id,
          spreadsheet_config_id: config.id,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: { points: 100 },
          participantName: 'Team A',
        });

        expect(res.status).toBe(200);
        const submission = res.json as { spreadsheet_config_id: number };
        expect(submission.spreadsheet_config_id).toBe(config.id);
      });

      it('returns 400 when linked spreadsheet config has been deleted', async () => {
        const user = await seedUser(testDb.db);
        // Create a config, then create template linked to it, then delete the config
        const config = await seedSpreadsheetConfig(testDb.db, {
          user_id: user.id,
          is_active: true,
        });
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'Deleted Config Template',
          created_by: user.id,
          spreadsheet_config_id: config.id,
        });

        // Delete the config (simulating it being removed after template was created)
        // First disable FK checks temporarily to allow deletion
        await testDb.db.exec('PRAGMA foreign_keys = OFF');
        await testDb.db.run('DELETE FROM spreadsheet_configs WHERE id = ?', [
          config.id,
        ]);
        await testDb.db.exec('PRAGMA foreign_keys = ON');

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: { points: 100 },
        });

        expect(res.status).toBe(400);
        expect((res.json as { error: string }).error).toContain(
          'no longer exists',
        );
      });

      it('returns 400 when linked spreadsheet config is not active', async () => {
        const user = await seedUser(testDb.db);
        const config = await seedSpreadsheetConfig(testDb.db, {
          user_id: user.id,
          spreadsheet_id: 'inactive-sheet',
          sheet_name: 'InactiveSheet',
          is_active: false, // Inactive!
        });
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'Inactive Config Template',
          created_by: user.id,
          spreadsheet_config_id: config.id,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: { points: 100 },
        });

        expect(res.status).toBe(400);
        expect((res.json as { error: string }).error).toContain('not active');
      });
    });

    describe('Spreadsheet Config Selection - Fallback by Purpose', () => {
      it('falls back to active scores config for non-head-to-head submissions', async () => {
        const user = await seedUser(testDb.db);
        const scoresConfig = await seedSpreadsheetConfig(testDb.db, {
          user_id: user.id,
          spreadsheet_id: 'scores-sheet',
          sheet_name: 'Scores',
          sheet_purpose: 'scores',
          is_active: true,
        });
        // Also create a bracket config that should NOT be used
        await seedSpreadsheetConfig(testDb.db, {
          user_id: user.id,
          spreadsheet_id: 'bracket-sheet',
          sheet_name: 'Brackets',
          sheet_purpose: 'bracket',
          is_active: true,
        });
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'No Link Template',
          created_by: user.id,
          spreadsheet_config_id: null, // No linked config
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: { points: 100 },
          isHeadToHead: false, // Not head-to-head
        });

        expect(res.status).toBe(200);
        const submission = res.json as { spreadsheet_config_id: number };
        expect(submission.spreadsheet_config_id).toBe(scoresConfig.id);
      });

      it('falls back to active bracket config for head-to-head submissions', async () => {
        const user = await seedUser(testDb.db);
        // Create scores config that should NOT be used
        await seedSpreadsheetConfig(testDb.db, {
          user_id: user.id,
          spreadsheet_id: 'scores-sheet',
          sheet_name: 'Scores',
          sheet_purpose: 'scores',
          is_active: true,
        });
        const bracketConfig = await seedSpreadsheetConfig(testDb.db, {
          user_id: user.id,
          spreadsheet_id: 'bracket-sheet',
          sheet_name: 'Brackets',
          sheet_purpose: 'bracket',
          is_active: true,
        });
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'No Link Template',
          created_by: user.id,
          spreadsheet_config_id: null,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: { points: 100 },
          isHeadToHead: true,
          bracketSource: { bracketId: 1, gameId: 5 },
        });

        expect(res.status).toBe(200);
        const submission = res.json as { spreadsheet_config_id: number };
        expect(submission.spreadsheet_config_id).toBe(bracketConfig.id);
      });

      it('returns 400 when no active config found for fallback', async () => {
        const user = await seedUser(testDb.db);
        // No spreadsheet configs at all
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'No Config Template',
          created_by: user.id,
          spreadsheet_config_id: null,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: { points: 100 },
        });

        expect(res.status).toBe(400);
        expect((res.json as { error: string }).error).toContain(
          'No active spreadsheet configuration found',
        );
      });

      it('returns 400 when no matching purpose config for head-to-head', async () => {
        const user = await seedUser(testDb.db);
        // Only scores config, no bracket config
        await seedSpreadsheetConfig(testDb.db, {
          user_id: user.id,
          spreadsheet_id: 'scores-sheet',
          sheet_purpose: 'scores',
          is_active: true,
        });
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'No Bracket Config Template',
          created_by: user.id,
          spreadsheet_config_id: null,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: { points: 100 },
          isHeadToHead: true,
          bracketSource: { bracketId: 1 },
        });

        expect(res.status).toBe(400);
        expect((res.json as { error: string }).error).toContain(
          'No active spreadsheet configuration found',
        );
      });
    });

    describe('Score Data Enrichment', () => {
      it('adds _isHeadToHead and _bracketSource metadata to score_data', async () => {
        const user = await seedUser(testDb.db);
        const config = await seedSpreadsheetConfig(testDb.db, {
          user_id: user.id,
          sheet_purpose: 'bracket',
          is_active: true,
        });
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'Test Template',
          created_by: user.id,
          spreadsheet_config_id: config.id,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: { points: 100, bonus: 25 },
          isHeadToHead: true,
          bracketSource: { bracketId: 5, gameId: 10 },
        });

        expect(res.status).toBe(200);
        const submission = res.json as { score_data: string };
        const scoreData = JSON.parse(submission.score_data);

        expect(scoreData.points).toBe(100);
        expect(scoreData.bonus).toBe(25);
        expect(scoreData._isHeadToHead).toEqual({ value: true, type: 'boolean' });
        expect(scoreData._bracketSource).toEqual({
          value: { bracketId: 5, gameId: 10 },
          type: 'object',
        });
      });

      it('defaults _isHeadToHead to false when not provided', async () => {
        const user = await seedUser(testDb.db);
        const config = await seedSpreadsheetConfig(testDb.db, {
          user_id: user.id,
          sheet_purpose: 'scores',
          is_active: true,
        });
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'Test Template',
          created_by: user.id,
          spreadsheet_config_id: config.id,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: { points: 50 },
        });

        expect(res.status).toBe(200);
        const submission = res.json as { score_data: string };
        const scoreData = JSON.parse(submission.score_data);

        expect(scoreData._isHeadToHead).toEqual({ value: false, type: 'boolean' });
        expect(scoreData._bracketSource).toEqual({ value: null, type: 'object' });
      });
    });

    describe('Successful Submission', () => {
      it('creates score submission with all fields', async () => {
        const user = await seedUser(testDb.db);
        const config = await seedSpreadsheetConfig(testDb.db, {
          user_id: user.id,
          is_active: true,
        });
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'Test Template',
          created_by: user.id,
          spreadsheet_config_id: config.id,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          participantName: 'Team Alpha',
          matchId: 'match-123',
          scoreData: { points: 75, penalties: -10 },
        });

        expect(res.status).toBe(200);
        const submission = res.json as {
          id: number;
          user_id: number | null;
          template_id: number;
          spreadsheet_config_id: number;
          participant_name: string;
          match_id: string;
          submitted_to_sheet: number;
          status: string;
        };

        expect(submission.id).toBeGreaterThan(0);
        expect(submission.user_id).toBeNull(); // Public submission has no user
        expect(submission.template_id).toBe(template.id);
        expect(submission.spreadsheet_config_id).toBe(config.id);
        expect(submission.participant_name).toBe('Team Alpha');
        expect(submission.match_id).toBe('match-123');
        expect(submission.submitted_to_sheet).toBe(0); // Not auto-submitted
        expect(submission.status).toBe('pending'); // Awaiting admin approval
      });

      it('allows submission without participantName and matchId', async () => {
        const user = await seedUser(testDb.db);
        const config = await seedSpreadsheetConfig(testDb.db, {
          user_id: user.id,
          is_active: true,
        });
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'Test Template',
          created_by: user.id,
          spreadsheet_config_id: config.id,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: { score: 100 },
        });

        expect(res.status).toBe(200);
        const submission = res.json as {
          participant_name: string | null;
          match_id: string | null;
        };
        expect(submission.participant_name).toBeNull();
        expect(submission.match_id).toBeNull();
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
        expect((res.json as { error: string }).error).toContain('Invalid event');
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

      it('uses legacy spreadsheet path when eventId/scoreType not provided', async () => {
        const user = await seedUser(testDb.db);
        const config = await seedSpreadsheetConfig(testDb.db, {
          user_id: user.id,
          is_active: true,
        });
        const template = await seedScoresheetTemplate(testDb.db, {
          name: 'Legacy Template',
          created_by: user.id,
          spreadsheet_config_id: config.id,
        });

        const res = await http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: { points: 50 },
          // No eventId, no scoreType - should use spreadsheet path
        });

        expect(res.status).toBe(200);
        const submission = res.json as {
          spreadsheet_config_id: number | null;
          event_id: number | null;
          score_type: string | null;
        };
        expect(submission.spreadsheet_config_id).toBe(config.id);
        expect(submission.event_id).toBeNull();
        expect(submission.score_type).toBeNull();
      });
    });
  });
});
