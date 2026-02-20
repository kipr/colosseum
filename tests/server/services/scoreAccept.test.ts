/**
 * Integration tests for score acceptance service.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
} from '../../http/helpers/seed';

describe('acceptEventScore', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  describe('errors', () => {
    it('returns 404 when submission not found', async () => {
      const result = await acceptEventScore({
        db: testDb.db,
        submissionId: 99999,
        force: false,
        reviewedBy: 1,
        ipAddress: null,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(404);
        expect(result.error).toBe('Score submission not found');
      }
    });

    it('returns 400 when score is not event-scoped', async () => {
      const template = await seedScoresheetTemplate(testDb.db);
      const submission = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({
          team_id: { value: 1 },
          round: { value: 1 },
          grand_total: { value: 100 },
        }),
        event_id: null,
        score_type: 'seeding',
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
        expect(result.error).toContain('not event-scoped');
      }
    });

    it('returns 400 when score is already accepted', async () => {
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
          grand_total: { value: 100 },
        }),
        event_id: event.id,
        score_type: 'seeding',
        status: 'accepted',
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
        expect(result.error).toBe('Score is already accepted');
      }
    });

    it('returns 400 when seeding score missing team_id', async () => {
      const event = await seedEvent(testDb.db);
      const template = await seedScoresheetTemplate(testDb.db);
      const submission = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({
          round: { value: 1 },
          grand_total: { value: 100 },
        }),
        event_id: event.id,
        score_type: 'seeding',
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
        expect(result.error).toContain('team_id and round_number');
      }
    });

    it('returns 400 when seeding score missing round_number', async () => {
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
          grand_total: { value: 100 },
        }),
        event_id: event.id,
        score_type: 'seeding',
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
        expect(result.error).toContain('team_id and round_number');
      }
    });

    it('returns 409 when seeding conflict without force', async () => {
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
          grand_total: { value: 200 },
        }),
        event_id: event.id,
        score_type: 'seeding',
      });

      await testDb.db.run(
        `INSERT INTO seeding_scores (team_id, round_number, score, scored_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [team.id, 1, 99],
      );

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
        expect(result.error).toContain('already exists');
        expect(result.existingScore).toBe(99);
        expect(result.newScore).toBe(200);
      }
    });

    it('returns 400 when bracket score missing bracket_game_id', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
        team_name: 'Team A',
      });
      const template = await seedScoresheetTemplate(testDb.db);
      const submission = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({
          winner_team_id: { value: team.id },
          team1_score: { value: 100 },
          team2_score: { value: 80 },
        }),
        event_id: event.id,
        score_type: 'bracket',
        bracket_game_id: null,
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
        expect(result.error).toContain('bracket_game_id');
      }
    });

    it('returns 400 when bracket score missing winner', async () => {
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
      const submission = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({
          team1_score: { value: 100 },
          team2_score: { value: 80 },
        }),
        event_id: event.id,
        score_type: 'bracket',
        bracket_game_id: game.id,
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
        expect(result.error).toContain('winner');
      }
    });

    it('returns 400 when winner is not one of the teams in the game', async () => {
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
      const team3 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 3,
        team_name: 'Team C',
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
      const submission = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({
          winner_team_id: { value: team3.id },
          team1_score: { value: 100 },
          team2_score: { value: 80 },
        }),
        event_id: event.id,
        score_type: 'bracket',
        bracket_game_id: game.id,
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
        expect(result.error).toContain('Winner must be one of the teams');
      }
    });

    it('returns 400 for unknown score_type', async () => {
      const event = await seedEvent(testDb.db);
      const template = await seedScoresheetTemplate(testDb.db);
      const submission = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({}),
        event_id: event.id,
        score_type: 'unknown_type',
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
        expect(result.error).toContain('Unknown score_type');
      }
    });
  });

  describe('seeding success', () => {
    it('accepts seeding score and creates audit entry', async () => {
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

      const result = await acceptEventScore({
        db: testDb.db,
        submissionId: submission.id,
        force: false,
        reviewedBy: admin.id,
        ipAddress: '127.0.0.1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.scoreType).toBe('seeding');
        expect(result.seedingScoreId).toBeDefined();
      }

      const auditLogs = await testDb.db.all(
        'SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ?',
        ['score_submission', submission.id],
      );
      expect(auditLogs.length).toBe(1);
      expect(auditLogs[0].action).toBe('score_accepted');
      expect(auditLogs[0].user_id).toBe(admin.id);

      const updated = await testDb.db.get(
        'SELECT * FROM score_submissions WHERE id = ?',
        [submission.id],
      );
      expect(updated.status).toBe('accepted');
      expect(updated.reviewed_by).toBe(admin.id);
    });

    it('uses score_auto_accepted when reviewedBy is null', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
        team_name: 'Auto Team',
      });
      const template = await seedScoresheetTemplate(testDb.db);
      const submission = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({
          team_id: { value: team.id },
          round: { value: 1 },
          grand_total: { value: 180 },
        }),
        event_id: event.id,
        score_type: 'seeding',
      });

      const result = await acceptEventScore({
        db: testDb.db,
        submissionId: submission.id,
        force: false,
        reviewedBy: null,
        ipAddress: null,
      });

      expect(result.ok).toBe(true);

      const auditLogs = await testDb.db.all(
        'SELECT action, user_id FROM audit_log WHERE entity_type = ? AND entity_id = ?',
        ['score_submission', submission.id],
      );
      expect(auditLogs.length).toBe(1);
      expect(auditLogs[0].action).toBe('score_auto_accepted');
      expect(auditLogs[0].user_id).toBeNull();
    });

    it('overrides existing score when force=true', async () => {
      await seedUser(testDb.db);
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
          grand_total: { value: 200 },
        }),
        event_id: event.id,
        score_type: 'seeding',
      });

      await testDb.db.run(
        `INSERT INTO seeding_scores (team_id, round_number, score, scored_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [team.id, 1, 99],
      );

      const result = await acceptEventScore({
        db: testDb.db,
        submissionId: submission.id,
        force: true,
        reviewedBy: 1,
        ipAddress: null,
      });

      expect(result.ok).toBe(true);

      const score = await testDb.db.get(
        'SELECT score FROM seeding_scores WHERE team_id = ? AND round_number = ?',
        [team.id, 1],
      );
      expect(score.score).toBe(200);
    });
  });

  describe('bracket success', () => {
    it('accepts bracket score and updates game', async () => {
      await seedUser(testDb.db);
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
      const submission = await seedScoreSubmission(testDb.db, {
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

      const result = await acceptEventScore({
        db: testDb.db,
        submissionId: submission.id,
        force: false,
        reviewedBy: 1,
        ipAddress: null,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.scoreType).toBe('bracket');
        expect(result.bracketGameId).toBe(game.id);
        expect(result.winnerId).toBe(team1.id);
        expect(result.loserId).toBe(team2.id);
      }

      const updatedGame = await testDb.db.get(
        'SELECT * FROM bracket_games WHERE id = ?',
        [game.id],
      );
      expect(updatedGame.winner_id).toBe(team1.id);
      expect(updatedGame.loser_id).toBe(team2.id);
      expect(updatedGame.team1_score).toBe(100);
      expect(updatedGame.team2_score).toBe(80);
      expect(updatedGame.status).toBe('completed');

      const auditLogs = await testDb.db.all(
        'SELECT action FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY created_at',
        ['score_submission', submission.id],
      );
      expect(auditLogs.map((r: { action: string }) => r.action)).toContain(
        'score_accepted',
      );
    });
  });
});
