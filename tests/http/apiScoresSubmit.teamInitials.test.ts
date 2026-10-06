/**
 * HTTP tests for team initials on POST /api/scores/submit: every participating
 * team must initial, for every result type, when the sheet requires it.
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
} from './helpers/seed';
import apiRoutes from '../../src/server/routes/api';
import scoresRoutes from '../../src/server/routes/scores';
import { resetAllRateLimiters } from '../../src/server/middleware/rateLimit';

describe('Team initials on score submission', () => {
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

  function seedTemplate(schema: Record<string, unknown>) {
    return seedScoresheetTemplate(testDb.db, {
      name: 'Initials Template',
      schema: JSON.stringify(schema),
      created_by: null,
    });
  }

  const requiredSchema = { teamInitials: { required: true }, fields: [] };

  async function setupBracket(
    schema: Record<string, unknown> = requiredSchema,
  ) {
    const event = await seedEvent(testDb.db);
    const team1 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 101,
      team_name: 'Alpha',
    });
    const team2 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 202,
      team_name: 'Beta',
    });
    const bracket = await seedBracket(testDb.db, {
      event_id: event.id,
      name: 'Main Bracket',
      bracket_size: 4,
    });
    const game = await seedBracketGame(testDb.db, {
      bracket_id: bracket.id,
      game_number: 1,
      team1_id: team1.id,
      team2_id: team2.id,
      status: 'ready',
    });
    const template = await seedTemplate(schema);

    const body = (overrides: Record<string, unknown> = {}) => ({
      templateId: template.id,
      participantName: '101 - Alpha',
      matchId: '1',
      scoreData: {
        winner_team_id: { value: team1.id, type: 'number' },
        team1_score: { value: 10, type: 'number' },
        team2_score: { value: 5, type: 'number' },
      },
      isHeadToHead: true,
      eventId: event.id,
      scoreType: 'bracket',
      bracket_game_id: game.id,
      ...overrides,
    });

    return { event, team1, team2, game, template, body };
  }

  async function storedInitials(submissionId: number) {
    return testDb.db.all<{ side: string; team_id: number; initials: string }>(
      `SELECT side, team_id, initials FROM score_team_initials
       WHERE score_submission_id = ? ORDER BY side`,
      [submissionId],
    );
  }

  async function submissionCount() {
    const row = await testDb.db.get<{ count: string }>(
      'SELECT COUNT(*) AS count FROM score_submissions',
    );
    return Number(row?.count);
  }

  describe('bracket games', () => {
    it('rejects a disqualification missing the disqualified team initials', async () => {
      const { team2, body } = await setupBracket();

      const res = await http.post(
        `${baseUrl}/api/scores/submit`,
        body({
          resultType: 'disqualification',
          disqualifiedTeamId: team2.id,
          resultNote: 'Rule 4.2',
          teamInitials: [{ side: 'team_a', initials: 'AB' }],
        }),
      );

      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toBe(
        'Team initials are required for team 202',
      );
      expect(await submissionCount()).toBe(0);
    });

    it('rejects a no contest submitted without any initials', async () => {
      const { body } = await setupBracket();

      const res = await http.post(
        `${baseUrl}/api/scores/submit`,
        body({ resultType: 'no_contest' }),
      );

      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toBe(
        'Team initials are required for team 101',
      );
      expect(await submissionCount()).toBe(0);
    });

    it('stores normalized initials against each team for a disqualification', async () => {
      const { team1, team2, body } = await setupBracket();

      const res = await http.post(
        `${baseUrl}/api/scores/submit`,
        body({
          resultType: 'disqualification',
          disqualifiedTeamId: team2.id,
          resultNote: 'Rule 4.2',
          teamInitials: [
            { side: 'team_a', initials: 'a.b.' },
            { side: 'team_b', initials: ' cd ' },
          ],
        }),
      );

      expect(res.status).toBe(200);
      const submission = res.json as { id: number };
      expect(await storedInitials(submission.id)).toEqual([
        { side: 'team_a', team_id: team1.id, initials: 'AB' },
        { side: 'team_b', team_id: team2.id, initials: 'CD' },
      ]);

      const audit = await testDb.db.get<{ new_value: string }>(
        `SELECT new_value FROM audit_log
         WHERE action = 'score_submitted' AND entity_id = ?`,
        [submission.id],
      );
      expect(JSON.parse(audit!.new_value).team_initials).toEqual([
        { side: 'team_a', team_id: team1.id, initials: 'AB' },
        { side: 'team_b', team_id: team2.id, initials: 'CD' },
      ]);
    });

    it('includes the initials in the admin score listing', async () => {
      const { event, team1, team2, body } = await setupBracket();
      const submitted = await http.post(
        `${baseUrl}/api/scores/submit`,
        body({
          teamInitials: [
            { side: 'team_a', initials: 'AB' },
            { side: 'team_b', initials: 'CD' },
          ],
        }),
      );
      expect(submitted.status).toBe(200);

      const res = await http.get(`${baseUrl}/scores/by-event/${event.id}`);
      expect(res.status).toBe(200);
      const rows = (res.json as { rows: Array<{ team_initials: unknown }> })
        .rows;
      expect(rows[0].team_initials).toEqual([
        { side: 'team_a', team_id: team1.id, team_number: 101, initials: 'AB' },
        { side: 'team_b', team_id: team2.id, team_number: 202, initials: 'CD' },
      ]);
    });

    it.each([
      [
        'invalid initials',
        [
          { side: 'team_a', initials: 'A' },
          { side: 'team_b', initials: 'CD' },
        ],
        'Team initials for team 101 must be 2–5 letters',
      ],
      [
        'a side with no team in the game',
        [
          { side: 'team', initials: 'AB' },
          { side: 'team_a', initials: 'AB' },
          { side: 'team_b', initials: 'CD' },
        ],
        'Team initials were submitted for team, which has no team in this match',
      ],
      [
        'a duplicate side',
        [
          { side: 'team_a', initials: 'AB' },
          { side: 'team_a', initials: 'CD' },
        ],
        'Team initials were submitted more than once for team_a',
      ],
      [
        'an unknown side',
        [{ side: 'referee', initials: 'AB' }],
        'Unknown team initials side: referee',
      ],
    ])('rejects %s', async (_label, teamInitials, error) => {
      const { body } = await setupBracket();

      const res = await http.post(
        `${baseUrl}/api/scores/submit`,
        body({ teamInitials }),
      );

      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toBe(error);
      expect(await submissionCount()).toBe(0);
    });

    it('does not require initials when the sheet turns them off', async () => {
      const { body } = await setupBracket({
        teamInitials: { required: false },
        fields: [{ id: 'team_a_team_initials', type: 'text' }],
      });

      const res = await http.post(`${baseUrl}/api/scores/submit`, body());

      expect(res.status).toBe(200);
      expect(await storedInitials((res.json as { id: number }).id)).toEqual([]);
    });

    it('requires initials on older sheets that carry legacy initials fields', async () => {
      const { body } = await setupBracket({
        fields: [
          { id: 'team_a_team_initials', type: 'text', required: true },
          { id: 'team_b_team_initials', type: 'text', required: true },
        ],
      });

      const res = await http.post(`${baseUrl}/api/scores/submit`, body());

      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toBe(
        'Team initials are required for team 101',
      );
    });
  });

  describe('seeding', () => {
    it('requires the single team to initial', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 7,
      });
      const template = await seedTemplate(requiredSchema);
      const body = (teamInitials?: unknown) => ({
        templateId: template.id,
        participantName: 'Team 7',
        matchId: '1',
        scoreData: {
          team_id: { value: team.id, type: 'number' },
          round: { value: 1, type: 'number' },
          grand_total: { value: 50, type: 'number' },
        },
        eventId: event.id,
        scoreType: 'seeding',
        teamInitials,
      });

      const missing = await http.post(`${baseUrl}/api/scores/submit`, body());
      expect(missing.status).toBe(400);
      expect((missing.json as { error: string }).error).toBe(
        'Team initials are required for team 7',
      );

      const ok = await http.post(
        `${baseUrl}/api/scores/submit`,
        body([{ side: 'team', initials: 'xy' }]),
      );
      expect(ok.status).toBe(200);
      expect(await storedInitials((ok.json as { id: number }).id)).toEqual([
        { side: 'team', team_id: team.id, initials: 'XY' },
      ]);
    });
  });

  describe('double seeding', () => {
    it('requires only team A on a solo run', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 9,
      });
      const match = await seedDoubleSeedingMatch(testDb.db, {
        event_id: event.id,
        round_number: 1,
        match_number: 1,
        team1_id: team.id,
        team2_id: null,
      });
      const template = await seedTemplate(requiredSchema);
      const body = (teamInitials: unknown) => ({
        templateId: template.id,
        participantName: '9 - Solo run',
        matchId: 'Round 1',
        scoreData: {
          team_a_total: { value: 40, type: 'number' },
          team_a_id: { value: team.id, type: 'number' },
          round: { value: 1, type: 'number' },
        },
        eventId: event.id,
        scoreType: 'double_seeding',
        double_seeding_match_id: match.id,
        teamInitials,
      });

      const withTeamB = await http.post(
        `${baseUrl}/api/scores/submit`,
        body([
          { side: 'team_a', initials: 'AB' },
          { side: 'team_b', initials: 'CD' },
        ]),
      );
      expect(withTeamB.status).toBe(400);

      const ok = await http.post(
        `${baseUrl}/api/scores/submit`,
        body([{ side: 'team_a', initials: 'AB' }]),
      );
      expect(ok.status).toBe(200);
      expect(await storedInitials((ok.json as { id: number }).id)).toEqual([
        { side: 'team_a', team_id: team.id, initials: 'AB' },
      ]);
    });
  });
});
