/**
 * Direct integration tests for the `submitEventScore` use case.
 *
 * The HTTP-level wiring is exercised in `tests/http/apiScoresSubmit.test.ts`.
 * These tests focus on the use-case discriminated-union contract and the
 * cross-entity side effects (queue updates, audit log, auto-accept).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { submitEventScore } from '../../../src/server/usecases/submitEventScore';
import {
  seedEvent,
  seedTeam,
  seedBracket,
  seedBracketGame,
  seedScoresheetTemplate,
  seedQueueItem,
} from '../../http/helpers/seed';

describe('submitEventScore', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  describe('validation', () => {
    it('returns 400 when templateId is missing', async () => {
      const result = await submitEventScore({
        db: testDb.db,
        body: { scoreData: { points: { value: 1 } } },
        ipAddress: null,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.error).toContain('Template ID and score data');
      }
    });

    it('returns 400 when scoreData is missing', async () => {
      const result = await submitEventScore({
        db: testDb.db,
        body: { templateId: 1 },
        ipAddress: null,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
      }
    });

    it('returns 400 when template does not exist', async () => {
      const result = await submitEventScore({
        db: testDb.db,
        body: { templateId: 999, scoreData: { x: { value: 1 } } },
        ipAddress: null,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Template not found');
      }
    });

    it('returns 400 when submission is not event-scoped', async () => {
      const template = await seedScoresheetTemplate(testDb.db);

      const result = await submitEventScore({
        db: testDb.db,
        body: { templateId: template.id, scoreData: { x: { value: 1 } } },
        ipAddress: null,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Event-scoped submission is required');
      }
    });

    it('returns 400 when bracket_game_id missing for bracket submission', async () => {
      const event = await seedEvent(testDb.db);
      const template = await seedScoresheetTemplate(testDb.db);

      const result = await submitEventScore({
        db: testDb.db,
        body: {
          templateId: template.id,
          scoreData: { winner_team_id: { value: 1 } },
          eventId: event.id,
          scoreType: 'bracket',
        },
        ipAddress: null,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('bracket_game_id is required');
      }
    });

    it('returns 400 when team belongs to a different event (cross-event isolation)', async () => {
      const eventA = await seedEvent(testDb.db);
      const eventB = await seedEvent(testDb.db);
      const teamInB = await seedTeam(testDb.db, {
        event_id: eventB.id,
        team_number: 1,
      });
      const template = await seedScoresheetTemplate(testDb.db);

      const result = await submitEventScore({
        db: testDb.db,
        body: {
          templateId: template.id,
          scoreData: {
            team_id: { value: teamInB.id },
            round: { value: 1 },
            grand_total: { value: 100 },
          },
          eventId: eventA.id,
          scoreType: 'seeding',
        },
        ipAddress: null,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('does not belong to this event');
      }
    });

    it('returns 400 when bracket game does not belong to the event', async () => {
      const eventA = await seedEvent(testDb.db);
      const eventB = await seedEvent(testDb.db);
      const bracketB = await seedBracket(testDb.db, { event_id: eventB.id });
      const team1 = await seedTeam(testDb.db, {
        event_id: eventB.id,
        team_number: 1,
      });
      const team2 = await seedTeam(testDb.db, {
        event_id: eventB.id,
        team_number: 2,
      });
      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracketB.id,
        game_number: 1,
        team1_id: team1.id,
        team2_id: team2.id,
      });
      const template = await seedScoresheetTemplate(testDb.db);

      const result = await submitEventScore({
        db: testDb.db,
        body: {
          templateId: template.id,
          scoreData: { winner_team_id: { value: team1.id } },
          eventId: eventA.id,
          scoreType: 'bracket',
          bracket_game_id: game.id,
        },
        ipAddress: null,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Bracket game not found');
      }
    });
  });

  describe('seeding submission', () => {
    it('inserts submission, enriches scoreData with team_id, and writes audit row', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 42,
      });
      const template = await seedScoresheetTemplate(testDb.db);

      const result = await submitEventScore({
        db: testDb.db,
        body: {
          templateId: template.id,
          scoreData: {
            team_number: { value: 42 },
            round: { value: 1 },
            grand_total: { value: 150 },
          },
          eventId: event.id,
          scoreType: 'seeding',
        },
        ipAddress: '10.0.0.1',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.autoAccepted).toBe(false);

      const submission = result.submission as {
        id: number;
        event_id: number;
        score_type: string;
        status: string;
        score_data: string;
      };
      expect(submission.event_id).toBe(event.id);
      expect(submission.score_type).toBe('seeding');
      expect(submission.status).toBe('pending');

      const scoreData = JSON.parse(submission.score_data);
      expect(scoreData.team_id?.value).toBe(team.id);
      expect(scoreData._isHeadToHead?.value).toBe(false);

      const audit = await testDb.db.get<{
        action: string;
        ip_address: string | null;
      }>(
        `SELECT action, ip_address FROM audit_log
         WHERE event_id = ? AND entity_type = 'score_submission' AND entity_id = ?`,
        [event.id, submission.id],
      );
      expect(audit?.action).toBe('score_submitted');
      expect(audit?.ip_address).toBe('10.0.0.1');
    });

    it('marks matching seeding queue item as scored on submit', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 7,
      });
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 1,
        seeding_team_id: team.id,
        seeding_round: 1,
        status: 'queued',
      });
      const template = await seedScoresheetTemplate(testDb.db);

      await submitEventScore({
        db: testDb.db,
        body: {
          templateId: template.id,
          scoreData: {
            team_id: { value: team.id },
            round: { value: 1 },
            grand_total: { value: 100 },
          },
          eventId: event.id,
          scoreType: 'seeding',
        },
        ipAddress: null,
      });

      const queueItem = await testDb.db.get<{ status: string }>(
        `SELECT status FROM game_queue
         WHERE event_id = ? AND queue_type = 'seeding' AND seeding_team_id = ? AND seeding_round = ?`,
        [event.id, team.id, 1],
      );
      expect(queueItem?.status).toBe('scored');
    });
  });

  describe('bracket submission', () => {
    it('inserts a bracket score with bracket_game_id linkage', async () => {
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
      const template = await seedScoresheetTemplate(testDb.db);

      const result = await submitEventScore({
        db: testDb.db,
        body: {
          templateId: template.id,
          scoreData: {
            winner_team_id: { value: team1.id },
            team1_score: { value: 100 },
            team2_score: { value: 80 },
          },
          isHeadToHead: true,
          eventId: event.id,
          scoreType: 'bracket',
          bracket_game_id: game.id,
        },
        ipAddress: null,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const submission = result.submission as {
        bracket_game_id: number;
        score_type: string;
      };
      expect(submission.bracket_game_id).toBe(game.id);
      expect(submission.score_type).toBe('bracket');
    });
  });

  describe('auto-accept', () => {
    it('returns autoAccepted=true with accepted submission when mode is auto_accept_seeding', async () => {
      const event = await seedEvent(testDb.db, {
        score_accept_mode: 'auto_accept_seeding',
      });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const template = await seedScoresheetTemplate(testDb.db);

      const result = await submitEventScore({
        db: testDb.db,
        body: {
          templateId: template.id,
          scoreData: {
            team_id: { value: team.id },
            round: { value: 1 },
            grand_total: { value: 200 },
          },
          eventId: event.id,
          scoreType: 'seeding',
        },
        ipAddress: null,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.autoAccepted).toBe(true);
      const submission = result.submission as {
        status: string;
        reviewed_by: number | null;
      };
      expect(submission.status).toBe('accepted');
      expect(submission.reviewed_by).toBeNull();
    });

    it('leaves submission pending when auto-accept hits a conflict (force=false)', async () => {
      const event = await seedEvent(testDb.db, {
        score_accept_mode: 'auto_accept_seeding',
      });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const template = await seedScoresheetTemplate(testDb.db);

      // Pre-existing accepted score for the same team/round will conflict.
      await testDb.db.run(
        `INSERT INTO seeding_scores (team_id, round_number, score, scored_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [team.id, 1, 99],
      );

      const result = await submitEventScore({
        db: testDb.db,
        body: {
          templateId: template.id,
          scoreData: {
            team_id: { value: team.id },
            round: { value: 1 },
            grand_total: { value: 200 },
          },
          eventId: event.id,
          scoreType: 'seeding',
        },
        ipAddress: null,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.autoAccepted).toBe(false);
      const submission = result.submission as { status: string };
      expect(submission.status).toBe('pending');
    });

    it('does not auto-accept bracket submissions when mode is auto_accept_seeding', async () => {
      const event = await seedEvent(testDb.db, {
        score_accept_mode: 'auto_accept_seeding',
      });
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
      const template = await seedScoresheetTemplate(testDb.db);

      const result = await submitEventScore({
        db: testDb.db,
        body: {
          templateId: template.id,
          scoreData: {
            winner_team_id: { value: team1.id },
            team1_score: { value: 100 },
            team2_score: { value: 80 },
          },
          eventId: event.id,
          scoreType: 'bracket',
          bracket_game_id: game.id,
        },
        ipAddress: null,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.autoAccepted).toBe(false);
    });

    it('auto-accepts everything when mode is auto_accept_all', async () => {
      const event = await seedEvent(testDb.db, {
        score_accept_mode: 'auto_accept_all',
      });
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
      const template = await seedScoresheetTemplate(testDb.db);

      const result = await submitEventScore({
        db: testDb.db,
        body: {
          templateId: template.id,
          scoreData: {
            winner_team_id: { value: team1.id },
            team1_score: { value: 100 },
            team2_score: { value: 80 },
          },
          eventId: event.id,
          scoreType: 'bracket',
          bracket_game_id: game.id,
        },
        ipAddress: null,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.autoAccepted).toBe(true);
      const submission = result.submission as { status: string };
      expect(submission.status).toBe('accepted');
    });
  });
});
