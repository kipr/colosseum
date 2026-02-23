/**
 * HTTP route tests for score revert-event edge cases.
 * Targets uncovered paths in src/server/routes/scores.ts revert-event handler.
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
  seedUser,
  seedTeam,
  seedBracket,
  seedBracketGame,
  seedScoresheetTemplate,
  seedSpreadsheetConfig,
  seedScoreSubmission,
  seedQueueItem,
} from './helpers/seed';
import scoresRoutes from '../../src/server/routes/scores';

describe('Scores Revert-Event Edge Cases', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let adminUser: { id: number };

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
    adminUser = await seedUser(testDb.db, { is_admin: true });
    const app = createTestApp({ user: { id: adminUser.id, is_admin: true } });
    app.use('/scores', scoresRoutes);
    server = await startServer(app);
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('reverts seeding score with no linked seeding_score_id', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    const template = await seedScoresheetTemplate(testDb.db);
    const score = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({
        team_id: { value: team.id },
        round: { value: 1 },
      }),
      event_id: event.id,
      score_type: 'seeding',
      seeding_score_id: null,
      status: 'accepted',
    });

    const res = await http.post(
      `${server.baseUrl}/scores/${score.id}/revert-event`,
    );
    expect(res.status).toBe(200);
    const data = res.json as { success: boolean; scoreType: string };
    expect(data.success).toBe(true);
    expect(data.scoreType).toBe('seeding');

    const submission = await testDb.db.get(
      'SELECT status FROM score_submissions WHERE id = ?',
      [score.id],
    );
    expect(submission.status).toBe('pending');
  });

  it('restores seeding queue item when reverting score with no linked seeding_score_id', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'seeding',
      queue_position: 1,
      seeding_team_id: team.id,
      seeding_round: 1,
      status: 'completed',
    });
    const template = await seedScoresheetTemplate(testDb.db);
    const score = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({
        team_id: { value: team.id },
        round: { value: 1 },
      }),
      event_id: event.id,
      score_type: 'seeding',
      seeding_score_id: null,
      status: 'accepted',
    });

    const res = await http.post(
      `${server.baseUrl}/scores/${score.id}/revert-event`,
    );
    expect(res.status).toBe(200);

    const queueItem = await testDb.db.get(
      "SELECT status FROM game_queue WHERE event_id = ? AND seeding_team_id = ? AND seeding_round = ?",
      [event.id, team.id, 1],
    );
    expect(queueItem.status).toBe('queued');
  });

  it('reverts bracket score with no linked bracket_game_id', async () => {
    const event = await seedEvent(testDb.db);
    const template = await seedScoresheetTemplate(testDb.db);
    const score = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({
        winner_team_id: { value: 1 },
      }),
      event_id: event.id,
      score_type: 'bracket',
      bracket_game_id: null,
      status: 'accepted',
    });

    const res = await http.post(
      `${server.baseUrl}/scores/${score.id}/revert-event`,
    );
    expect(res.status).toBe(200);
    const data = res.json as { success: boolean; scoreType: string };
    expect(data.success).toBe(true);
    expect(data.scoreType).toBe('bracket');
  });

  it('reverts bracket score when game has no winner', async () => {
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
    const score = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({ winner_team_id: { value: team1.id } }),
      event_id: event.id,
      score_type: 'bracket',
      bracket_game_id: game.id,
      status: 'accepted',
    });

    const res = await http.post(
      `${server.baseUrl}/scores/${score.id}/revert-event`,
    );
    expect(res.status).toBe(200);
    const data = res.json as { success: boolean; scoreType: string };
    expect(data.success).toBe(true);
    expect(data.scoreType).toBe('bracket');
  });

  it('returns bracket queue item to queued when reverting bracket score with no winner', async () => {
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
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'bracket',
      queue_position: 1,
      bracket_game_id: game.id,
      status: 'completed',
    });
    const template = await seedScoresheetTemplate(testDb.db);
    const score = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({}),
      event_id: event.id,
      score_type: 'bracket',
      bracket_game_id: game.id,
      status: 'accepted',
    });

    const res = await http.post(
      `${server.baseUrl}/scores/${score.id}/revert-event`,
    );
    expect(res.status).toBe(200);

    const queueItem = await testDb.db.get(
      "SELECT status FROM game_queue WHERE bracket_game_id = ?",
      [game.id],
    );
    expect(queueItem.status).toBe('queued');
  });

  it('returns 400 for non-event-scoped score', async () => {
    const template = await seedScoresheetTemplate(testDb.db);
    const score = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: '{}',
      event_id: null,
      status: 'accepted',
    });

    const res = await http.post(
      `${server.baseUrl}/scores/${score.id}/revert-event`,
    );
    expect(res.status).toBe(400);
    expect((res.json as { error: string }).error).toContain('not event-scoped');
  });

  it('returns 400 for unknown score_type', async () => {
    const event = await seedEvent(testDb.db);
    const template = await seedScoresheetTemplate(testDb.db);
    const score = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: '{}',
      event_id: event.id,
      score_type: 'unknown_type',
      status: 'accepted',
    });

    const res = await http.post(
      `${server.baseUrl}/scores/${score.id}/revert-event`,
    );
    expect(res.status).toBe(400);
    expect((res.json as { error: string }).error).toContain('Unknown score_type');
  });

  it('returns dry-run for seeding revert', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    const template = await seedScoresheetTemplate(testDb.db);

    const seedingScoreResult = await testDb.db.run(
      'INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, ?, ?)',
      [team.id, 1, 100],
    );

    const score = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({
        team_id: { value: team.id },
        round: { value: 1 },
      }),
      event_id: event.id,
      score_type: 'seeding',
      seeding_score_id: seedingScoreResult.lastID,
      status: 'accepted',
    });

    const res = await http.post(
      `${server.baseUrl}/scores/${score.id}/revert-event`,
      { dryRun: true },
    );
    expect(res.status).toBe(200);
    const data = res.json as {
      requiresConfirmation: boolean;
      scoreType: string;
    };
    expect(data.requiresConfirmation).toBe(false);
    expect(data.scoreType).toBe('seeding');
  });

  it('confirms bracket revert without cascade when no downstream games', async () => {
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
      status: 'completed',
    });
    await testDb.db.run(
      'UPDATE bracket_games SET winner_id = ?, loser_id = ? WHERE id = ?',
      [team1.id, team2.id, game.id],
    );
    const template = await seedScoresheetTemplate(testDb.db);
    const score = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({}),
      event_id: event.id,
      score_type: 'bracket',
      bracket_game_id: game.id,
      status: 'accepted',
    });

    // Confirm without dry-run, no downstream games
    const res = await http.post(
      `${server.baseUrl}/scores/${score.id}/revert-event`,
      { confirm: true },
    );
    expect(res.status).toBe(200);
    const data = res.json as { success: boolean; revertedGames: number };
    expect(data.success).toBe(true);
    expect(data.revertedGames).toBe(1);

    // Game should be reset
    const updatedGame = await testDb.db.get(
      'SELECT winner_id, status FROM bracket_games WHERE id = ?',
      [game.id],
    );
    expect(updatedGame.winner_id).toBeNull();
    expect(updatedGame.status).toBe('ready');
  });

  it('rejects a score and creates audit entry for event-scoped score', async () => {
    const event = await seedEvent(testDb.db);
    const template = await seedScoresheetTemplate(testDb.db);
    const score = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({}),
      event_id: event.id,
      score_type: 'seeding',
      status: 'pending',
    });

    const res = await http.post(
      `${server.baseUrl}/scores/${score.id}/reject`,
    );
    expect(res.status).toBe(200);

    const audit = await testDb.db.get(
      "SELECT * FROM audit_log WHERE action = 'score_rejected' AND entity_id = ?",
      [score.id],
    );
    expect(audit).toBeTruthy();
    expect(audit.event_id).toBe(event.id);
  });

  // ==========================================================================
  // Bulk accept edge cases
  // ==========================================================================

  describe('Bulk accept edge cases', () => {
    it('skips bracket score with no bracket_game_id', async () => {
      const event = await seedEvent(testDb.db);
      const template = await seedScoresheetTemplate(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({
          winner_team_id: { value: team.id },
        }),
        event_id: event.id,
        score_type: 'bracket',
        bracket_game_id: null,
        status: 'pending',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/event/${event.id}/accept/bulk`,
        { score_ids: [score.id] },
      );
      expect(res.status).toBe(200);
      const data = res.json as {
        accepted: number;
        skipped?: { id: number; reason: string }[];
      };
      expect(data.accepted).toBe(0);
      expect(data.skipped).toBeDefined();
      expect(data.skipped![0].reason).toContain('bracket_game_id');
    });

    it('skips bracket score with no winner specified', async () => {
      const event = await seedEvent(testDb.db);
      const bracket = await seedBracket(testDb.db, { event_id: event.id });
      const team1 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const team2 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 2,
      });
      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: team1.id,
        team2_id: team2.id,
        status: 'ready',
      });
      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({}),
        event_id: event.id,
        score_type: 'bracket',
        bracket_game_id: game.id,
        status: 'pending',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/event/${event.id}/accept/bulk`,
        { score_ids: [score.id] },
      );
      expect(res.status).toBe(200);
      const data = res.json as {
        accepted: number;
        skipped?: { id: number; reason: string }[];
      };
      expect(data.accepted).toBe(0);
      expect(data.skipped![0].reason).toContain('winner');
    });

    it('skips bracket score when winner not in game', async () => {
      const event = await seedEvent(testDb.db);
      const bracket = await seedBracket(testDb.db, { event_id: event.id });
      const team1 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const team2 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 2,
      });
      const team3 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 3,
      });
      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: team1.id,
        team2_id: team2.id,
        status: 'ready',
      });
      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({
          winner_team_id: { value: team3.id },
        }),
        event_id: event.id,
        score_type: 'bracket',
        bracket_game_id: game.id,
        status: 'pending',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/event/${event.id}/accept/bulk`,
        { score_ids: [score.id] },
      );
      expect(res.status).toBe(200);
      const data = res.json as {
        accepted: number;
        skipped?: { id: number; reason: string }[];
      };
      expect(data.accepted).toBe(0);
      expect(data.skipped![0].reason).toContain('one of the teams');
    });

    it('skips bracket score when game already has different winner', async () => {
      const event = await seedEvent(testDb.db);
      const bracket = await seedBracket(testDb.db, { event_id: event.id });
      const team1 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const team2 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 2,
      });
      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: team1.id,
        team2_id: team2.id,
        status: 'completed',
      });
      await testDb.db.run(
        'UPDATE bracket_games SET winner_id = ? WHERE id = ?',
        [team1.id, game.id],
      );
      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({
          winner_team_id: { value: team2.id },
        }),
        event_id: event.id,
        score_type: 'bracket',
        bracket_game_id: game.id,
        status: 'pending',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/event/${event.id}/accept/bulk`,
        { score_ids: [score.id] },
      );
      expect(res.status).toBe(200);
      const data = res.json as {
        accepted: number;
        skipped?: { id: number; reason: string }[];
      };
      expect(data.accepted).toBe(0);
      expect(data.skipped![0].reason).toContain('different winner');
    });

    it('skips seeding score without team_id or round_number', async () => {
      const event = await seedEvent(testDb.db);
      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({
          grand_total: { value: 100 },
        }),
        event_id: event.id,
        score_type: 'seeding',
        status: 'pending',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/event/${event.id}/accept/bulk`,
        { score_ids: [score.id] },
      );
      expect(res.status).toBe(200);
      const data = res.json as {
        accepted: number;
        skipped?: { id: number; reason: string }[];
      };
      expect(data.accepted).toBe(0);
      expect(data.skipped![0].reason).toContain('team_id and round_number');
    });

    it('skips unknown score_type in bulk', async () => {
      const event = await seedEvent(testDb.db);
      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({}),
        event_id: event.id,
        score_type: 'weird',
        status: 'pending',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/event/${event.id}/accept/bulk`,
        { score_ids: [score.id] },
      );
      expect(res.status).toBe(200);
      const data = res.json as {
        accepted: number;
        skipped?: { id: number; reason: string }[];
      };
      expect(data.accepted).toBe(0);
      expect(data.skipped![0].reason).toContain('Unknown score_type');
    });

    it('skips seeding score when existing score has value', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      // Pre-existing score for team/round
      await testDb.db.run(
        'INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, ?, ?)',
        [team.id, 1, 999],
      );
      const template = await seedScoresheetTemplate(testDb.db);
      const score = await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({
          team_id: { value: team.id },
          round: { value: 1 },
          grand_total: { value: 100 },
        }),
        event_id: event.id,
        score_type: 'seeding',
        status: 'pending',
      });

      const res = await http.post(
        `${server.baseUrl}/scores/event/${event.id}/accept/bulk`,
        { score_ids: [score.id] },
      );
      expect(res.status).toBe(200);
      const data = res.json as {
        accepted: number;
        skipped?: { id: number; reason: string }[];
      };
      expect(data.accepted).toBe(0);
      expect(data.skipped![0].reason).toContain('already exists');
    });
  });
});
