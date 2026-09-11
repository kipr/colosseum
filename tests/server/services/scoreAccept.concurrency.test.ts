/**
 * Concurrent acceptEventScore approvals and downstream-failure rollback.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { acceptEventScore } from '../../../src/server/services/scoreAccept';
import {
  seedEvent,
  seedUser,
  seedTeam,
  seedBracket,
  seedBracketGame,
  seedScoresheetTemplate,
  seedScoreSubmission,
  seedQueueItem,
  seedDoubleSeedingMatch,
} from '../../http/helpers/seed';

const rankingFailure = vi.hoisted(() => ({
  seeding: false,
  doubleSeeding: false,
}));

vi.mock(
  '../../../src/server/services/seedingRankings',
  async (importOriginal) => {
    const orig =
      await importOriginal<
        typeof import('../../../src/server/services/seedingRankings')
      >();
    return {
      ...orig,
      recalculateSeedingRankings: vi.fn(
        async (eventId: number, db?: unknown) => {
          if (rankingFailure.seeding) {
            throw new Error('ranking failed');
          }
          return orig.recalculateSeedingRankings(
            eventId,
            db as Parameters<typeof orig.recalculateSeedingRankings>[1],
          );
        },
      ),
    };
  },
);

vi.mock(
  '../../../src/server/services/doubleSeedingRankings',
  async (importOriginal) => {
    const orig =
      await importOriginal<
        typeof import('../../../src/server/services/doubleSeedingRankings')
      >();
    return {
      ...orig,
      recalculateDoubleSeedingRankings: vi.fn(
        async (eventId: number, db?: unknown) => {
          if (rankingFailure.doubleSeeding) {
            throw new Error('ranking failed');
          }
          return orig.recalculateDoubleSeedingRankings(
            eventId,
            db as Parameters<typeof orig.recalculateDoubleSeedingRankings>[1],
          );
        },
      ),
    };
  },
);

describe('acceptEventScore concurrency', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    rankingFailure.seeding = false;
    rankingFailure.doubleSeeding = false;
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    rankingFailure.seeding = false;
    rankingFailure.doubleSeeding = false;
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('allows only one concurrent seeding approval without force', async () => {
    const admin = await seedUser(testDb.db, { is_admin: true });
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
      team_name: 'Team',
    });
    const template = await seedScoresheetTemplate(testDb.db);
    const first = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({
        team_id: { value: team.id },
        round: { value: 1 },
        grand_total: { value: 100 },
      }),
      event_id: event.id,
      score_type: 'seeding',
    });
    const second = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({
        team_id: { value: team.id },
        round: { value: 1 },
        grand_total: { value: 200 },
      }),
      event_id: event.id,
      score_type: 'seeding',
    });
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'seeding',
      seeding_team_id: team.id,
      seeding_round: 1,
      queue_position: 1,
      status: 'scored',
    });

    const results = await Promise.all([
      acceptEventScore({
        db: testDb.db,
        submissionId: first.id,
        force: false,
        reviewedBy: admin.id,
        ipAddress: null,
      }),
      acceptEventScore({
        db: testDb.db,
        submissionId: second.id,
        force: false,
        reviewedBy: admin.id,
        ipAddress: null,
      }),
    ]);

    const accepted = results.filter((result) => result.ok);
    const rejected = results.filter((result) => !result.ok);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (!rejected[0].ok) {
      expect(rejected[0].status).toBe(409);
      expect(rejected[0].error).toContain('already exists');
    }

    const submissions = await testDb.db.all<{ id: number; status: string }>(
      'SELECT id, status FROM score_submissions ORDER BY id',
    );
    const acceptedIds = submissions
      .filter((row) => row.status === 'accepted')
      .map((row) => row.id);
    const pendingIds = submissions
      .filter((row) => row.status === 'pending')
      .map((row) => row.id);
    expect(acceptedIds).toHaveLength(1);
    expect(pendingIds).toHaveLength(1);

    const scores = await testDb.db.all<{
      score: number;
      score_submission_id: number;
    }>(
      'SELECT score, score_submission_id FROM seeding_scores WHERE team_id = ? AND round_number = ?',
      [team.id, 1],
    );
    expect(scores).toHaveLength(1);
    expect(scores[0].score_submission_id).toBe(acceptedIds[0]);
    expect([100, 200]).toContain(scores[0].score);

    const queue = await testDb.db.all(
      `SELECT id FROM game_queue WHERE event_id = ? AND seeding_team_id = ? AND seeding_round = ?`,
      [event.id, team.id, 1],
    );
    expect(queue).toHaveLength(0);

    const audit = await testDb.db.all(
      `SELECT entity_id FROM audit_log WHERE action = 'score_accepted'`,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].entity_id).toBe(acceptedIds[0]);
  });

  it('rolls back a seeding accept when ranking recalculation fails', async () => {
    rankingFailure.seeding = true;
    const admin = await seedUser(testDb.db, { is_admin: true });
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
      team_name: 'Team',
    });
    const template = await seedScoresheetTemplate(testDb.db);
    const submission = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({
        team_id: { value: team.id },
        round: { value: 1 },
        grand_total: { value: 150 },
      }),
      event_id: event.id,
      score_type: 'seeding',
    });
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'seeding',
      seeding_team_id: team.id,
      seeding_round: 1,
      queue_position: 1,
      status: 'scored',
    });

    await expect(
      acceptEventScore({
        db: testDb.db,
        submissionId: submission.id,
        force: false,
        reviewedBy: admin.id,
        ipAddress: null,
      }),
    ).rejects.toThrow('ranking failed');

    const updated = await testDb.db.get<{ status: string }>(
      'SELECT status FROM score_submissions WHERE id = ?',
      [submission.id],
    );
    expect(updated?.status).toBe('pending');

    const scores = await testDb.db.all(
      'SELECT id FROM seeding_scores WHERE team_id = ? AND round_number = ?',
      [team.id, 1],
    );
    expect(scores).toHaveLength(0);

    const audit = await testDb.db.all(
      'SELECT id FROM audit_log WHERE entity_type = ? AND entity_id = ?',
      ['score_submission', submission.id],
    );
    expect(audit).toHaveLength(0);

    const queue = await testDb.db.all(
      `SELECT id FROM game_queue WHERE event_id = ? AND seeding_team_id = ? AND seeding_round = ?`,
      [event.id, team.id, 1],
    );
    expect(queue).toHaveLength(1);
  });

  it('allows only one concurrent bracket approval without force', async () => {
    const admin = await seedUser(testDb.db, { is_admin: true });
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
    const bracket = await seedBracket(testDb.db, { event_id: event.id });
    const game = await seedBracketGame(testDb.db, {
      bracket_id: bracket.id,
      game_number: 1,
      team1_id: team1.id,
      team2_id: team2.id,
      status: 'ready',
    });
    const template = await seedScoresheetTemplate(testDb.db);
    const first = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({
        winner_team_id: { value: team1.id },
        team1_score: { value: 100 },
        team2_score: { value: 80 },
      }),
      event_id: event.id,
      score_type: 'bracket',
      bracket_game_id: game.id,
    });
    const second = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({
        winner_team_id: { value: team2.id },
        team1_score: { value: 70 },
        team2_score: { value: 90 },
      }),
      event_id: event.id,
      score_type: 'bracket',
      bracket_game_id: game.id,
    });
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'bracket',
      bracket_game_id: game.id,
      queue_position: 1,
      status: 'scored',
    });

    const results = await Promise.all([
      acceptEventScore({
        db: testDb.db,
        submissionId: first.id,
        force: false,
        reviewedBy: admin.id,
        ipAddress: null,
      }),
      acceptEventScore({
        db: testDb.db,
        submissionId: second.id,
        force: false,
        reviewedBy: admin.id,
        ipAddress: null,
      }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    const conflict = results.find((result) => !result.ok);
    if (conflict && !conflict.ok) {
      expect(conflict.status).toBe(409);
    }

    const updatedGame = await testDb.db.get<{
      winner_id: number;
      score_submission_id: number;
    }>(
      'SELECT winner_id, score_submission_id FROM bracket_games WHERE id = ?',
      [game.id],
    );
    expect([team1.id, team2.id]).toContain(updatedGame?.winner_id);

    const submissions = await testDb.db.all<{ id: number; status: string }>(
      'SELECT id, status FROM score_submissions ORDER BY id',
    );
    const accepted = submissions.filter((row) => row.status === 'accepted');
    expect(accepted).toHaveLength(1);
    expect(updatedGame?.score_submission_id).toBe(accepted[0].id);

    const queue = await testDb.db.all(
      'SELECT id FROM game_queue WHERE bracket_game_id = ?',
      [game.id],
    );
    expect(queue).toHaveLength(0);
  });

  it('allows only one concurrent double-seeding approval without force', async () => {
    const admin = await seedUser(testDb.db, { is_admin: true });
    const event = await seedEvent(testDb.db, { double_seeding_rounds: 5 });
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
      round_number: 2,
      match_number: 1,
      team1_id: team1.id,
      team2_id: team2.id,
    });
    const template = await seedScoresheetTemplate(testDb.db);
    const first = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({
        team_a_total: { value: 75 },
        team_b_total: { value: 40 },
        team_a_id: { value: team1.id },
        team_b_id: { value: team2.id },
        round: { value: 2 },
      }),
      event_id: event.id,
      score_type: 'double_seeding',
      double_seeding_match_id: match.id,
    });
    const second = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({
        team_a_total: { value: 10 },
        team_b_total: { value: 20 },
        team_a_id: { value: team1.id },
        team_b_id: { value: team2.id },
        round: { value: 2 },
      }),
      event_id: event.id,
      score_type: 'double_seeding',
      double_seeding_match_id: match.id,
    });
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'double_seeding',
      double_seeding_match_id: match.id,
      queue_position: 1,
      status: 'scored',
    });

    const results = await Promise.all([
      acceptEventScore({
        db: testDb.db,
        submissionId: first.id,
        force: false,
        reviewedBy: admin.id,
        ipAddress: null,
      }),
      acceptEventScore({
        db: testDb.db,
        submissionId: second.id,
        force: false,
        reviewedBy: admin.id,
        ipAddress: null,
      }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    const conflict = results.find((result) => !result.ok);
    if (conflict && !conflict.ok) {
      expect(conflict.status).toBe(409);
    }

    const scores = await testDb.db.all<{
      side: string;
      score: number;
      score_submission_id: number;
    }>(
      'SELECT side, score, score_submission_id FROM double_seeding_scores WHERE match_id = ? ORDER BY side',
      [match.id],
    );
    expect(scores).toHaveLength(2);
    expect(scores[0].score_submission_id).toBe(scores[1].score_submission_id);

    const submissions = await testDb.db.all<{ id: number; status: string }>(
      'SELECT id, status FROM score_submissions ORDER BY id',
    );
    expect(submissions.filter((row) => row.status === 'accepted')).toHaveLength(
      1,
    );
    expect(submissions.filter((row) => row.status === 'pending')).toHaveLength(
      1,
    );

    const queue = await testDb.db.all(
      'SELECT id FROM game_queue WHERE double_seeding_match_id = ?',
      [match.id],
    );
    expect(queue).toHaveLength(0);
  });

  it('rolls back a double-seeding accept when ranking recalculation fails', async () => {
    rankingFailure.doubleSeeding = true;
    const admin = await seedUser(testDb.db, { is_admin: true });
    const event = await seedEvent(testDb.db, { double_seeding_rounds: 5 });
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
      round_number: 2,
      match_number: 1,
      team1_id: team1.id,
      team2_id: team2.id,
    });
    const template = await seedScoresheetTemplate(testDb.db);
    const submission = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({
        team_a_total: { value: 75 },
        team_b_total: { value: 40 },
        team_a_id: { value: team1.id },
        team_b_id: { value: team2.id },
        round: { value: 2 },
      }),
      event_id: event.id,
      score_type: 'double_seeding',
      double_seeding_match_id: match.id,
    });
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'double_seeding',
      double_seeding_match_id: match.id,
      queue_position: 1,
      status: 'scored',
    });

    await expect(
      acceptEventScore({
        db: testDb.db,
        submissionId: submission.id,
        force: false,
        reviewedBy: admin.id,
        ipAddress: null,
      }),
    ).rejects.toThrow('ranking failed');

    const updated = await testDb.db.get<{ status: string }>(
      'SELECT status FROM score_submissions WHERE id = ?',
      [submission.id],
    );
    expect(updated?.status).toBe('pending');

    const scores = await testDb.db.all(
      'SELECT id FROM double_seeding_scores WHERE match_id = ?',
      [match.id],
    );
    expect(scores).toHaveLength(0);

    const matchRow = await testDb.db.get<{ status: string }>(
      'SELECT status FROM double_seeding_matches WHERE id = ?',
      [match.id],
    );
    expect(matchRow?.status).toBe('ready');

    const queue = await testDb.db.all(
      'SELECT id FROM game_queue WHERE double_seeding_match_id = ?',
      [match.id],
    );
    expect(queue).toHaveLength(1);
  });
});
