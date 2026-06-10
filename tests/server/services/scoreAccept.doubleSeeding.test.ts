/**
 * Tests for accepting double-seeding score submissions.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { acceptEventScore } from '../../../src/server/services/scoreAccept';
import {
  seedEvent,
  seedTeam,
  seedUser,
  seedScoresheetTemplate,
  seedScoreSubmission,
  seedDoubleSeedingMatch,
  seedDoubleSeedingScore,
  seedQueueItem,
} from '../../http/helpers/seed';

describe('acceptEventScore - double seeding', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
    // Reviewer user (id 1) for reviewedBy FK
    await seedUser(testDb.db, { is_admin: true });
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  async function setupMatch(options: { withTeam2?: boolean } = {}) {
    const { withTeam2 = true } = options;
    const event = await seedEvent(testDb.db, { double_seeding_rounds: 5 });
    const team1 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    const team2 = withTeam2
      ? await seedTeam(testDb.db, { event_id: event.id, team_number: 2 })
      : null;
    const match = await seedDoubleSeedingMatch(testDb.db, {
      event_id: event.id,
      round_number: 2,
      match_number: 1,
      team1_id: team1.id,
      team2_id: team2?.id ?? null,
    });
    const template = await seedScoresheetTemplate(testDb.db);
    return { event, team1, team2, match, template };
  }

  it('creates one score row per participating team with side-specific scores', async () => {
    const { event, team1, team2, match, template } = await setupMatch();
    const submission = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({
        team_a_total: { value: 75 },
        team_b_total: { value: 40 },
        team_a_id: { value: team1.id },
        team_b_id: { value: team2!.id },
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

    const result = await acceptEventScore({
      db: testDb.db,
      submissionId: submission.id,
      force: false,
      reviewedBy: null,
      ipAddress: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scoreType).toBe('double_seeding');
      expect(result.doubleSeedingMatchId).toBe(match.id);
    }

    const rows = await testDb.db.all(
      'SELECT * FROM double_seeding_scores WHERE match_id = ? ORDER BY side',
      [match.id],
    );
    expect(rows.length).toBe(2);
    // Team 1 receives only the Team A / side A score
    expect(rows[0].side).toBe('team1');
    expect(rows[0].team_id).toBe(team1.id);
    expect(rows[0].score).toBe(75);
    expect(rows[0].round_number).toBe(2);
    // Team 2 receives only the Team B / side B score
    expect(rows[1].side).toBe('team2');
    expect(rows[1].team_id).toBe(team2!.id);
    expect(rows[1].score).toBe(40);

    const updatedMatch = await testDb.db.get(
      'SELECT * FROM double_seeding_matches WHERE id = ?',
      [match.id],
    );
    expect(updatedMatch?.status).toBe('completed');
    expect(updatedMatch?.completed_at).not.toBeNull();
    expect(updatedMatch?.score_submission_id).toBe(submission.id);

    const updatedSubmission = await testDb.db.get(
      'SELECT * FROM score_submissions WHERE id = ?',
      [submission.id],
    );
    expect(updatedSubmission?.status).toBe('accepted');

    // Queue row removed on accept
    const queueRows = await testDb.db.all(
      'SELECT * FROM game_queue WHERE double_seeding_match_id = ?',
      [match.id],
    );
    expect(queueRows.length).toBe(0);

    // Rankings recalculated
    const rankings = await testDb.db.all(
      'SELECT * FROM double_seeding_rankings WHERE seed_rank IS NOT NULL',
    );
    expect(rankings.length).toBe(2);
  });

  it('creates only one score row for an odd-team lone run', async () => {
    const { event, team1, match, template } = await setupMatch({
      withTeam2: false,
    });
    const submission = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({
        team_a_total: { value: 33 },
        team_b_total: { value: 0 },
      }),
      event_id: event.id,
      score_type: 'double_seeding',
      double_seeding_match_id: match.id,
    });

    const result = await acceptEventScore({
      db: testDb.db,
      submissionId: submission.id,
      force: false,
      reviewedBy: 1,
      ipAddress: null,
    });

    expect(result.ok).toBe(true);
    const rows = await testDb.db.all(
      'SELECT * FROM double_seeding_scores WHERE match_id = ?',
      [match.id],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].team_id).toBe(team1.id);
    expect(rows[0].side).toBe('team1');
    expect(rows[0].score).toBe(33);
  });

  it('requires a linked double_seeding_match_id', async () => {
    const { event, template } = await setupMatch();
    const submission = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({ team_a_total: { value: 10 } }),
      event_id: event.id,
      score_type: 'double_seeding',
    });

    const result = await acceptEventScore({
      db: testDb.db,
      submissionId: submission.id,
      force: false,
      reviewedBy: 1,
      ipAddress: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain('double_seeding_match_id');
    }
  });

  it('rejects a match that belongs to a different event', async () => {
    const { template, match } = await setupMatch();
    const otherEvent = await seedEvent(testDb.db, { name: 'Other Event' });
    const submission = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({ team_a_total: { value: 10 } }),
      event_id: otherEvent.id,
      score_type: 'double_seeding',
      double_seeding_match_id: match.id,
    });

    const result = await acceptEventScore({
      db: testDb.db,
      submissionId: submission.id,
      force: false,
      reviewedBy: 1,
      ipAddress: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain('does not belong');
    }
  });

  it('rejects mismatched submitted team ids', async () => {
    const { event, team2, match, template } = await setupMatch();
    const submission = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({
        team_a_id: { value: team2!.id }, // wrong side
        team_a_total: { value: 10 },
      }),
      event_id: event.id,
      score_type: 'double_seeding',
      double_seeding_match_id: match.id,
    });

    const result = await acceptEventScore({
      db: testDb.db,
      submissionId: submission.id,
      force: false,
      reviewedBy: 1,
      ipAddress: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain('Team A');
    }
  });

  it('blocks acceptance when scores already exist for the match, unless forced', async () => {
    const { event, team1, team2, match, template } = await setupMatch();
    await seedDoubleSeedingScore(testDb.db, {
      event_id: event.id,
      match_id: match.id,
      team_id: team1.id,
      round_number: 2,
      side: 'team1',
      score: 11,
    });

    const submission = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({
        team_a_total: { value: 99 },
        team_b_total: { value: 88 },
      }),
      event_id: event.id,
      score_type: 'double_seeding',
      double_seeding_match_id: match.id,
    });

    const blocked = await acceptEventScore({
      db: testDb.db,
      submissionId: submission.id,
      force: false,
      reviewedBy: 1,
      ipAddress: null,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.status).toBe(409);
    }

    const forced = await acceptEventScore({
      db: testDb.db,
      submissionId: submission.id,
      force: true,
      reviewedBy: 1,
      ipAddress: null,
    });
    expect(forced.ok).toBe(true);

    const rows = await testDb.db.all(
      'SELECT * FROM double_seeding_scores WHERE match_id = ? ORDER BY side',
      [match.id],
    );
    expect(rows.length).toBe(2);
    expect(rows[0].score).toBe(99);
    expect(rows[1].score).toBe(88);
    expect(rows[1].team_id).toBe(team2!.id);
  });

  it('blocks acceptance when a team already has a score for the same round in another match', async () => {
    const { event, team1, match, template } = await setupMatch();
    const otherMatch = await seedDoubleSeedingMatch(testDb.db, {
      event_id: event.id,
      round_number: 2,
      match_number: 2,
      team1_id: team1.id,
    });
    await seedDoubleSeedingScore(testDb.db, {
      event_id: event.id,
      match_id: otherMatch.id,
      team_id: team1.id,
      round_number: 2,
      side: 'team1',
      score: 5,
    });

    const submission = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({
        team_a_total: { value: 50 },
        team_b_total: { value: 60 },
      }),
      event_id: event.id,
      score_type: 'double_seeding',
      double_seeding_match_id: match.id,
    });

    const result = await acceptEventScore({
      db: testDb.db,
      submissionId: submission.id,
      force: false,
      reviewedBy: 1,
      ipAddress: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
    }
  });
});
