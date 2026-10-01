/**
 * HTTP route tests for team initials sign-off: enforcement on
 * POST /api/scores/submit and protection on PUT /scores/:id.
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
  seedDoubleSeedingMatch,
  seedScoreSubmission,
} from './helpers/seed';
import apiRoutes from '../../src/server/routes/api';
import scoresRoutes from '../../src/server/routes/scores';
import { resetAllRateLimiters } from '../../src/server/middleware/rateLimit';

const INITIALS_SCHEMA = JSON.stringify({
  requireTeamInitials: true,
  fields: [],
});

interface SubmitResponse {
  id: number;
  status: string;
  team_a_initials: string | null;
  team_b_initials: string | null;
}

describe('Team initials sign-off', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
    resetAllRateLimiters();

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

  async function seedBracketScenario(
    options: { schema?: string; scoreAcceptMode?: string } = {},
  ) {
    const event = await seedEvent(testDb.db, {
      score_accept_mode: options.scoreAcceptMode ?? 'manual',
    });
    const team1 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 101,
      team_name: 'Alpha',
    });
    const team2 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 102,
      team_name: 'Beta',
    });
    const bracket = await seedBracket(testDb.db, { event_id: event.id });
    const game = await seedBracketGame(testDb.db, {
      bracket_id: bracket.id,
      game_number: 1,
      team1_id: team1.id,
      team2_id: team2.id,
      status: 'ready',
    });
    const template = await seedScoresheetTemplate(testDb.db, {
      schema: options.schema ?? INITIALS_SCHEMA,
    });
    return { event, team1, team2, game, template };
  }

  function submitBracket(
    scenario: Awaited<ReturnType<typeof seedBracketScenario>>,
    extra: Record<string, unknown> = {},
  ) {
    return http.post(`${baseUrl}/api/scores/submit`, {
      templateId: scenario.template.id,
      scoreData: {
        winner_team_id: { value: scenario.team1.id, type: 'number' },
        team1_score: { value: 50, type: 'number' },
        team2_score: { value: 10, type: 'number' },
      },
      eventId: scenario.event.id,
      scoreType: 'bracket',
      bracket_game_id: scenario.game.id,
      ...extra,
    });
  }

  describe('POST /api/scores/submit', () => {
    it.each([
      ['standard', {}],
      ['no_contest', { resultType: 'no_contest' }],
      ['disqualification', { resultType: 'disqualification' }],
    ])(
      'rejects a %s bracket result without initials from both teams',
      async (_label, resultFields) => {
        const scenario = await seedBracketScenario();
        const extra: Record<string, unknown> = { ...resultFields };
        if (extra.resultType === 'disqualification') {
          extra.disqualifiedTeamId = scenario.team2.id;
          extra.resultNote = 'Rule 4.2';
        }

        const res = await submitBracket(scenario, {
          ...extra,
          teamInitials: { team_a: 'AB' },
        });

        expect(res.status).toBe(400);
        const body = res.json as {
          error: string;
          teamInitialsErrors: Record<string, string>;
        };
        expect(body.error).toContain('Team initials');
        expect(Object.keys(body.teamInitialsErrors)).toEqual(['team_b']);
        const count = await testDb.db.get<{ count: number }>(
          'SELECT COUNT(*)::int AS count FROM score_submissions',
        );
        expect(count?.count).toBe(0);
      },
    );

    it('rejects invalid initials', async () => {
      const scenario = await seedBracketScenario();

      const res = await submitBracket(scenario, {
        teamInitials: { team_a: 'AB', team_b: 'A1' },
      });

      expect(res.status).toBe(400);
      expect(
        Object.keys(
          (res.json as { teamInitialsErrors: Record<string, string> })
            .teamInitialsErrors,
        ),
      ).toEqual(['team_b']);
    });

    it('stores normalized initials for a disqualification and audits them', async () => {
      const scenario = await seedBracketScenario();

      const res = await submitBracket(scenario, {
        resultType: 'disqualification',
        disqualifiedTeamId: scenario.team2.id,
        resultNote: 'Rule 4.2',
        teamInitials: { team_a: 'a.b.', team_b: ' cd ' },
      });

      expect(res.status).toBe(200);
      const submission = res.json as SubmitResponse;
      expect(submission.team_a_initials).toBe('AB');
      expect(submission.team_b_initials).toBe('CD');

      const audit = await testDb.db.get<{ new_value: string }>(
        `SELECT new_value FROM audit_log WHERE action = 'score_submitted' AND entity_id = ?`,
        [submission.id],
      );
      expect(JSON.parse(audit!.new_value)).toMatchObject({
        team_a_initials: 'AB',
        team_b_initials: 'CD',
      });
    });

    it('never auto-accepts without initials', async () => {
      const scenario = await seedBracketScenario({
        scoreAcceptMode: 'auto_accept_all',
      });

      const rejected = await submitBracket(scenario, {
        resultType: 'no_contest',
      });
      expect(rejected.status).toBe(400);
      const game = await testDb.db.get<{ winner_id: number | null }>(
        'SELECT winner_id FROM bracket_games WHERE id = ?',
        [scenario.game.id],
      );
      expect(game?.winner_id).toBeNull();

      const accepted = await submitBracket(scenario, {
        resultType: 'no_contest',
        teamInitials: { team_a: 'AB', team_b: 'CD' },
      });
      expect(accepted.status).toBe(200);
      expect((accepted.json as SubmitResponse).status).toBe('accepted');
    });

    it('requires legacy initials-field schemas to carry initials', async () => {
      const scenario = await seedBracketScenario({
        schema: JSON.stringify({
          fields: [
            { id: 'team_a_team_initials', type: 'text', required: true },
            { id: 'team_b_team_initials', type: 'text', required: true },
          ],
        }),
      });

      const res = await submitBracket(scenario);
      expect(res.status).toBe(400);
    });

    it('leaves sheets without the requirement unaffected', async () => {
      const scenario = await seedBracketScenario({
        schema: JSON.stringify({ requireTeamInitials: false, fields: [] }),
      });

      const res = await submitBracket(scenario);

      expect(res.status).toBe(200);
      expect((res.json as SubmitResponse).team_a_initials).toBeNull();
    });

    it('requires only the single team on seeding sheets', async () => {
      const event = await seedEvent(testDb.db);
      await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 7,
        team_name: 'Solo',
      });
      const template = await seedScoresheetTemplate(testDb.db, {
        schema: INITIALS_SCHEMA,
      });
      const submit = (teamInitials?: Record<string, string>) =>
        http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: {
            team_number: { value: '7', type: 'text' },
            round: { value: 1, type: 'number' },
            grand_total: { value: 25, type: 'number' },
          },
          eventId: event.id,
          scoreType: 'seeding',
          teamInitials,
        });

      expect((await submit()).status).toBe(400);
      expect((await submit({ team_a: 'XY', team_b: 'ZZ' })).status).toBe(400);
      const res = await submit({ team_a: 'xy' });
      expect(res.status).toBe(200);
      expect((res.json as SubmitResponse).team_a_initials).toBe('XY');
    });

    it('requires only team A initials on a solo double-seeding match', async () => {
      const event = await seedEvent(testDb.db);
      const team1 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 11,
      });
      const team2 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 12,
      });
      const soloMatch = await seedDoubleSeedingMatch(testDb.db, {
        event_id: event.id,
        round_number: 1,
        match_number: 1,
        team1_id: team1.id,
      });
      const pairedMatch = await seedDoubleSeedingMatch(testDb.db, {
        event_id: event.id,
        round_number: 1,
        match_number: 2,
        team1_id: team1.id,
        team2_id: team2.id,
      });
      const template = await seedScoresheetTemplate(testDb.db, {
        schema: INITIALS_SCHEMA,
      });
      const submit = (matchId: number, teamInitials: Record<string, string>) =>
        http.post(`${baseUrl}/api/scores/submit`, {
          templateId: template.id,
          scoreData: {
            team_a_total: { value: 10, type: 'number' },
            team_b_total: { value: 20, type: 'number' },
          },
          eventId: event.id,
          scoreType: 'double_seeding',
          double_seeding_match_id: matchId,
          teamInitials,
        });

      expect((await submit(soloMatch.id, { team_a: 'AB' })).status).toBe(200);
      expect((await submit(pairedMatch.id, { team_a: 'AB' })).status).toBe(400);
      expect(
        (await submit(pairedMatch.id, { team_a: 'AB', team_b: 'CD' })).status,
      ).toBe(200);
    });
  });

  describe('PUT /scores/:id', () => {
    it('never changes recorded initials and flags score edits', async () => {
      const scenario = await seedBracketScenario();
      const submitRes = await submitBracket(scenario, {
        teamInitials: { team_a: 'AB', team_b: 'CD' },
      });
      const submission = submitRes.json as SubmitResponse;

      const unchanged = await testDb.db.get<{ score_data: string }>(
        'SELECT score_data FROM score_submissions WHERE id = ?',
        [submission.id],
      );
      const noopRes = await http.put(`${baseUrl}/scores/${submission.id}`, {
        scoreData: JSON.parse(unchanged!.score_data),
        resultType: 'standard',
        teamInitials: { team_a: 'ZZ', team_b: 'ZZ' },
      });
      expect(noopRes.status).toBe(200);
      let row = await testDb.db.get<{
        team_a_initials: string;
        team_b_initials: string;
        scores_edited_at: string | null;
      }>(
        'SELECT team_a_initials, team_b_initials, scores_edited_at FROM score_submissions WHERE id = ?',
        [submission.id],
      );
      expect(row).toMatchObject({
        team_a_initials: 'AB',
        team_b_initials: 'CD',
        scores_edited_at: null,
      });

      const editRes = await http.put(`${baseUrl}/scores/${submission.id}`, {
        scoreData: {
          ...JSON.parse(unchanged!.score_data),
          team1_score: { value: 60, type: 'number' },
        },
        resultType: 'standard',
      });
      expect(editRes.status).toBe(200);
      row = await testDb.db.get(
        'SELECT team_a_initials, team_b_initials, scores_edited_at FROM score_submissions WHERE id = ?',
        [submission.id],
      );
      expect(row?.team_a_initials).toBe('AB');
      expect(row?.team_b_initials).toBe('CD');
      expect(row?.scores_edited_at).not.toBeNull();
    });

    it('preserves legacy initials stored in score data', async () => {
      const scenario = await seedBracketScenario();
      const legacyScoreData = {
        winner_team_id: { value: scenario.team1.id, type: 'number' },
        team_a_team_initials: { label: 'Team Initials', value: 'AB' },
      };
      const seeded = await seedScoreSubmission(testDb.db, {
        template_id: scenario.template.id,
        score_data: JSON.stringify(legacyScoreData),
        event_id: scenario.event.id,
        bracket_game_id: scenario.game.id,
        score_type: 'bracket',
      });

      const res = await http.put(`${baseUrl}/scores/${seeded.id}`, {
        scoreData: {
          winner_team_id: legacyScoreData.winner_team_id,
          team_a_team_initials: { label: 'Team Initials', value: 'ZZ' },
          team_b_team_initials: { label: 'Team Initials', value: 'YY' },
        },
        resultType: 'standard',
      });

      expect(res.status).toBe(200);
      const row = await testDb.db.get<{ score_data: string }>(
        'SELECT score_data FROM score_submissions WHERE id = ?',
        [seeded.id],
      );
      const stored = JSON.parse(row!.score_data);
      expect(stored.team_a_team_initials.value).toBe('AB');
      expect(stored).not.toHaveProperty('team_b_team_initials');
    });
  });

  describe('GET /scores/by-event/:eventId', () => {
    it('flags submissions missing required initials', async () => {
      const scenario = await seedBracketScenario();
      await seedScoreSubmission(testDb.db, {
        template_id: scenario.template.id,
        score_data: JSON.stringify({}),
        event_id: scenario.event.id,
        bracket_game_id: scenario.game.id,
        score_type: 'bracket',
      });
      await submitBracket(scenario, {
        teamInitials: { team_a: 'AB', team_b: 'CD' },
      });

      const res = await http.get(
        `${baseUrl}/scores/by-event/${scenario.event.id}`,
      );

      expect(res.status).toBe(200);
      const rows = (
        res.json as {
          rows: Array<{
            team_a_initials: string | null;
            missing_team_initials: string[];
          }>;
        }
      ).rows;
      const missing = rows.map((row) => row.missing_team_initials);
      expect(missing).toEqual(
        expect.arrayContaining([['team_a', 'team_b'], []]),
      );
    });
  });
});
