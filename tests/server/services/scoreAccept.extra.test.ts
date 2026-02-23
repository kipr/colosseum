/**
 * Additional scoreAccept service tests targeting uncovered branches.
 * Covers grand final winner-side wins (no loser propagation), unknown score_type.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import {
  seedEvent,
  seedTeam,
  seedBracket,
  seedBracketGame,
  seedScoresheetTemplate,
  seedScoreSubmission,
  seedUser,
} from '../../http/helpers/seed';
import { acceptEventScore } from '../../../src/server/services/scoreAccept';

describe('scoreAccept - additional coverage', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(async () => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns error for unknown score_type', async () => {
    const event = await seedEvent(testDb.db);
    const template = await seedScoresheetTemplate(testDb.db);
    const score = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({}),
      event_id: event.id,
      score_type: 'weird_type',
      status: 'pending',
    });

    const result = await acceptEventScore({
      db: testDb.db,
      submissionId: score.id,
      force: false,
      reviewedBy: null,
      ipAddress: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Unknown score_type');
    }
  });

  it('handles bracket score with no bracket_game_id', async () => {
    const event = await seedEvent(testDb.db);
    const template = await seedScoresheetTemplate(testDb.db);
    const score = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({ winner_team_id: { value: 1 } }),
      event_id: event.id,
      score_type: 'bracket',
      bracket_game_id: null,
      status: 'pending',
    });

    const result = await acceptEventScore({
      db: testDb.db,
      submissionId: score.id,
      force: false,
      reviewedBy: null,
      ipAddress: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('bracket_game_id');
    }
  });

  it('handles bracket score with no winner specified', async () => {
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

    const result = await acceptEventScore({
      db: testDb.db,
      submissionId: score.id,
      force: false,
      reviewedBy: null,
      ipAddress: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('winner');
    }
  });

  it('handles bracket score where winner is not a participant', async () => {
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

    const result = await acceptEventScore({
      db: testDb.db,
      submissionId: score.id,
      force: false,
      reviewedBy: null,
      ipAddress: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('one of the teams');
    }
  });

  it('returns 409 when game has different winner without force', async () => {
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

    const result = await acceptEventScore({
      db: testDb.db,
      submissionId: score.id,
      force: false,
      reviewedBy: null,
      ipAddress: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.existingWinnerId).toBe(team1.id);
      expect(result.newWinnerId).toBe(team2.id);
    }
  });

  it('handles auto-accept (reviewedBy null) with correct audit action', async () => {
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
        grand_total: { value: 100 },
      }),
      event_id: event.id,
      score_type: 'seeding',
      status: 'pending',
    });

    const result = await acceptEventScore({
      db: testDb.db,
      submissionId: score.id,
      force: false,
      reviewedBy: null,
      ipAddress: null,
    });

    expect(result.ok).toBe(true);

    const audit = await testDb.db.get(
      "SELECT * FROM audit_log WHERE action = 'score_auto_accepted' AND entity_id = ?",
      [score.id],
    );
    expect(audit).toBeDefined();
  });

  it('does not propagate loser in grand final when winners bracket wins', async () => {
    const event = await seedEvent(testDb.db);
    const reviewer = await seedUser(testDb.db, { is_admin: true });
    const bracket = await seedBracket(testDb.db, { event_id: event.id });
    const team1 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    const team2 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 2,
    });

    // Create reset game
    const resetGame = await seedBracketGame(testDb.db, {
      bracket_id: bracket.id,
      game_number: 2,
      status: 'pending',
    });

    // Create grand final: winner_advances_to = reset, loser_advances_to = reset (same game)
    const grandFinal = await seedBracketGame(testDb.db, {
      bracket_id: bracket.id,
      game_number: 1,
      team1_id: team1.id,
      team2_id: team2.id,
      status: 'ready',
    });
    await testDb.db.run(
      `UPDATE bracket_games SET
        winner_advances_to_id = ?, winner_slot = 'team1',
        loser_advances_to_id = ?, loser_slot = 'team2'
       WHERE id = ?`,
      [resetGame.id, resetGame.id, grandFinal.id],
    );

    const template = await seedScoresheetTemplate(testDb.db);
    const score = await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: JSON.stringify({
        winner_team_id: { value: team1.id },
      }),
      event_id: event.id,
      score_type: 'bracket',
      bracket_game_id: grandFinal.id,
      status: 'pending',
    });

    const result = await acceptEventScore({
      db: testDb.db,
      submissionId: score.id,
      force: false,
      reviewedBy: reviewer.id,
      ipAddress: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scoreType).toBe('bracket');
    }

    // Reset game should have team1 in team1 slot but NOT team2 in team2 slot
    const updatedReset = await testDb.db.get(
      'SELECT team1_id, team2_id FROM bracket_games WHERE id = ?',
      [resetGame.id],
    );
    expect(updatedReset.team1_id).toBe(team1.id);
    expect(updatedReset.team2_id).toBeNull();
  });
});
