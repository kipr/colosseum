/**
 * HTTP tests for the double-seeding submission lifecycle:
 * submit -> queue -> accept / reject / revert / bulk accept.
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
  seedScoresheetTemplate,
  seedScoreSubmission,
  seedDoubleSeedingMatch,
  seedDoubleSeedingScore,
  seedQueueItem,
  seedUser,
} from './helpers/seed';
import apiRoutes from '../../src/server/routes/api';
import scoresRoutes from '../../src/server/routes/scores';
import queueRoutes from '../../src/server/routes/queue';
import { resetAllRateLimiters } from '../../src/server/middleware/rateLimit';

describe('Double Seeding Score Lifecycle', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
    resetAllRateLimiters();

    await seedUser(testDb.db, { is_admin: true });
    const app = createTestApp({ user: { id: 1, is_admin: true } });
    app.use('/api', apiRoutes);
    app.use('/scores', scoresRoutes);
    app.use('/queue', queueRoutes);

    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
    resetAllRateLimiters();
  });

  async function setup(options: { score_accept_mode?: string } = {}) {
    const event = await seedEvent(testDb.db, {
      double_seeding_rounds: 3,
      score_accept_mode: options.score_accept_mode ?? 'manual',
    });
    const team1 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    const team2 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 2,
    });
    const match = await seedDoubleSeedingMatch(testDb.db, {
      event_id: event.id,
      round_number: 1,
      match_number: 1,
      team1_id: team1.id,
      team2_id: team2.id,
    });
    const template = await seedScoresheetTemplate(testDb.db);
    return { event, team1, team2, match, template };
  }

  function submitBody(
    template: { id: number },
    event: { id: number },
    match: { id: number },
    overrides: Record<string, unknown> = {},
  ) {
    return {
      templateId: template.id,
      participantName: 'Team 1 vs Team 2',
      matchId: 'Round 1',
      scoreData: {
        team_a_total: { value: 55, type: 'number' },
        team_b_total: { value: 65, type: 'number' },
        round: { value: 1, type: 'number' },
      },
      eventId: event.id,
      scoreType: 'double_seeding',
      double_seeding_match_id: match.id,
      ...overrides,
    };
  }

  describe('POST /api/scores/submit', () => {
    it('requires double_seeding_match_id', async () => {
      const { event, template, match } = await setup();
      const res = await http.post(
        `${baseUrl}/api/scores/submit`,
        submitBody(template, event, match, {
          double_seeding_match_id: undefined,
        }),
      );
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'double_seeding_match_id is required',
      );
    });

    it('rejects match ids from another event', async () => {
      const { template, match } = await setup();
      const otherEvent = await seedEvent(testDb.db, { name: 'Other' });
      const res = await http.post(
        `${baseUrl}/api/scores/submit`,
        submitBody(template, otherEvent, match),
      );
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'does not belong to this event',
      );
    });

    it('creates a pending submission linked to the match and marks the queue scored', async () => {
      const { event, template, match } = await setup();
      const queueItem = await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'double_seeding',
        double_seeding_match_id: match.id,
        queue_position: 1,
      });

      const res = await http.post(
        `${baseUrl}/api/scores/submit`,
        submitBody(template, event, match),
      );
      expect(res.status).toBe(200);
      const submission = res.json as {
        id: number;
        status: string;
        score_type: string;
        double_seeding_match_id: number;
      };
      expect(submission.status).toBe('pending');
      expect(submission.score_type).toBe('double_seeding');
      expect(submission.double_seeding_match_id).toBe(match.id);

      const queueRow = await testDb.db.get(
        'SELECT status FROM game_queue WHERE id = ?',
        [queueItem.id],
      );
      expect(queueRow?.status).toBe('scored');
    });

    it('auto-accepts under auto_accept_all and writes per-team score rows', async () => {
      const { event, team1, team2, template, match } = await setup({
        score_accept_mode: 'auto_accept_all',
      });

      const res = await http.post(
        `${baseUrl}/api/scores/submit`,
        submitBody(template, event, match),
      );
      expect(res.status).toBe(200);
      expect((res.json as { status: string }).status).toBe('accepted');

      const rows = await testDb.db.all(
        'SELECT * FROM double_seeding_scores WHERE match_id = ? ORDER BY side',
        [match.id],
      );
      expect(rows.length).toBe(2);
      expect(rows[0].team_id).toBe(team1.id);
      expect(rows[0].score).toBe(55);
      expect(rows[1].team_id).toBe(team2.id);
      expect(rows[1].score).toBe(65);
    });
  });

  describe('POST /scores/:id/accept-event', () => {
    it('accepts a pending double-seeding submission', async () => {
      const { event, template, match } = await setup();
      const submitRes = await http.post(
        `${baseUrl}/api/scores/submit`,
        submitBody(template, event, match),
      );
      const submission = submitRes.json as { id: number };

      const res = await http.post(
        `${baseUrl}/scores/${submission.id}/accept-event`,
        {},
      );
      expect(res.status).toBe(200);
      const body = res.json as {
        success: boolean;
        scoreType: string;
        doubleSeedingMatchId: number;
      };
      expect(body.success).toBe(true);
      expect(body.scoreType).toBe('double_seeding');
      expect(body.doubleSeedingMatchId).toBe(match.id);

      const matchRow = await testDb.db.get(
        'SELECT status FROM double_seeding_matches WHERE id = ?',
        [match.id],
      );
      expect(matchRow?.status).toBe('completed');
    });
  });

  describe('GET /scores/by-event/:eventId', () => {
    it('filters by score_type=double_seeding and joins match display fields', async () => {
      const { event, template, match } = await setup();
      await http.post(
        `${baseUrl}/api/scores/submit`,
        submitBody(template, event, match),
      );
      // Unrelated seeding submission should be filtered out
      await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: '{}',
        event_id: event.id,
        score_type: 'seeding',
      });

      const res = await http.get(
        `${baseUrl}/scores/by-event/${event.id}?score_type=double_seeding`,
      );
      expect(res.status).toBe(200);
      const body = res.json as {
        rows: Array<{
          score_type: string;
          double_seeding_round: number;
          double_seeding_match_number: number;
          double_seeding_team1_number: number;
          double_seeding_team2_number: number;
        }>;
        totalCount: number;
      };
      expect(body.totalCount).toBe(1);
      expect(body.rows[0].score_type).toBe('double_seeding');
      expect(body.rows[0].double_seeding_round).toBe(1);
      expect(body.rows[0].double_seeding_match_number).toBe(1);
      expect(body.rows[0].double_seeding_team1_number).toBe(1);
      expect(body.rows[0].double_seeding_team2_number).toBe(2);
    });
  });

  describe('POST /scores/:id/reject', () => {
    it('restores the queue row to queued', async () => {
      const { event, template, match } = await setup();
      const queueItem = await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'double_seeding',
        double_seeding_match_id: match.id,
        queue_position: 1,
      });
      const submitRes = await http.post(
        `${baseUrl}/api/scores/submit`,
        submitBody(template, event, match),
      );
      const submission = submitRes.json as { id: number };

      const res = await http.post(
        `${baseUrl}/scores/${submission.id}/reject`,
        {},
      );
      expect(res.status).toBe(200);

      const submissionRow = await testDb.db.get(
        'SELECT status FROM score_submissions WHERE id = ?',
        [submission.id],
      );
      expect(submissionRow?.status).toBe('rejected');

      const queueRow = await testDb.db.get(
        'SELECT status FROM game_queue WHERE id = ?',
        [queueItem.id],
      );
      expect(queueRow?.status).toBe('queued');
    });
  });

  describe('POST /scores/:id/revert-event', () => {
    it('reverts without cascade confirmation, clearing scores and resetting state', async () => {
      const { event, template, match } = await setup();
      const submitRes = await http.post(
        `${baseUrl}/api/scores/submit`,
        submitBody(template, event, match),
      );
      const submission = submitRes.json as { id: number };
      await http.post(`${baseUrl}/scores/${submission.id}/accept-event`, {});

      // Dry run requires no confirmation
      const dryRun = await http.post(
        `${baseUrl}/scores/${submission.id}/revert-event`,
        { dryRun: true },
      );
      expect(dryRun.status).toBe(200);
      expect(
        (dryRun.json as { requiresConfirmation: boolean })
          .requiresConfirmation,
      ).toBe(false);

      const res = await http.post(
        `${baseUrl}/scores/${submission.id}/revert-event`,
        {},
      );
      expect(res.status).toBe(200);
      const body = res.json as {
        success: boolean;
        scoreType: string;
        clearedScoreIds: number[];
      };
      expect(body.success).toBe(true);
      expect(body.scoreType).toBe('double_seeding');
      expect(body.clearedScoreIds.length).toBe(2);

      const rows = await testDb.db.all(
        'SELECT * FROM double_seeding_scores WHERE match_id = ?',
        [match.id],
      );
      expect(rows.length).toBe(0);

      const matchRow = await testDb.db.get(
        'SELECT * FROM double_seeding_matches WHERE id = ?',
        [match.id],
      );
      expect(matchRow?.status).toBe('ready');
      expect(matchRow?.completed_at).toBeNull();
      expect(matchRow?.score_submission_id).toBeNull();

      const submissionRow = await testDb.db.get(
        'SELECT status FROM score_submissions WHERE id = ?',
        [submission.id],
      );
      expect(submissionRow?.status).toBe('pending');

      // Queue row restored as queued
      const queueRow = await testDb.db.get(
        'SELECT status FROM game_queue WHERE double_seeding_match_id = ?',
        [match.id],
      );
      expect(queueRow?.status).toBe('queued');

      // Rankings recalculated (no scores -> unranked)
      const rankings = await testDb.db.all(
        'SELECT * FROM double_seeding_rankings WHERE seed_rank IS NOT NULL',
      );
      expect(rankings.length).toBe(0);
    });
  });

  describe('POST /scores/event/:eventId/accept/bulk', () => {
    it('accepts mixed score types and skips conflicting submissions', async () => {
      const { event, team1, team2, template, match } = await setup();

      // Valid double-seeding submission
      const okRes = await http.post(
        `${baseUrl}/api/scores/submit`,
        submitBody(template, event, match),
      );
      const okSubmission = okRes.json as { id: number };

      // Valid seeding submission
      const seedingSubmission = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({
          team_id: { value: team1.id },
          round: { value: 1 },
          grand_total: { value: 88 },
        }),
        event_id: event.id,
        score_type: 'seeding',
      });

      // Conflicting double-seeding submission: same team/round via another match
      const conflictMatch = await seedDoubleSeedingMatch(testDb.db, {
        event_id: event.id,
        round_number: 1,
        match_number: 2,
        team1_id: team2.id,
      });
      const conflictSubmission = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({ team_a_total: { value: 1 } }),
        event_id: event.id,
        score_type: 'double_seeding',
        double_seeding_match_id: conflictMatch.id,
      });

      const res = await http.post(
        `${baseUrl}/scores/event/${event.id}/accept/bulk`,
        {
          score_ids: [
            okSubmission.id,
            seedingSubmission.id,
            conflictSubmission.id,
          ],
        },
      );
      expect(res.status).toBe(200);
      const body = res.json as {
        accepted: number;
        accepted_ids: number[];
        skipped?: Array<{ id: number; reason: string }>;
      };
      expect(body.accepted).toBe(2);
      expect(body.accepted_ids).toContain(okSubmission.id);
      expect(body.accepted_ids).toContain(seedingSubmission.id);
      expect(body.skipped?.length).toBe(1);
      expect(body.skipped?.[0].id).toBe(conflictSubmission.id);

      const doubleSeedingRows = await testDb.db.all(
        'SELECT * FROM double_seeding_scores WHERE match_id = ?',
        [match.id],
      );
      expect(doubleSeedingRows.length).toBe(2);

      const seedingRow = await testDb.db.get(
        'SELECT * FROM seeding_scores WHERE team_id = ? AND round_number = 1',
        [team1.id],
      );
      expect(seedingRow?.score).toBe(88);
    });
  });
});
