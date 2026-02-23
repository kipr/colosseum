/**
 * Timestamp Triggers Test
 *
 * Verifies that SQLite triggers automatically clear timestamps when status fields
 * are rolled back to earlier states.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from './helpers/testDb';

describe('Timestamp Cleanup Triggers', () => {
  let testDb: TestDb;
  let eventId: number;

  beforeEach(async () => {
    testDb = await createTestDb();

    // Setup basic event
    const eventResult = await testDb.db.run(
      `INSERT INTO events (name, status) VALUES (?, ?)`,
      ['Test Event', 'active'],
    );
    eventId = eventResult.lastID!;
  });

  afterEach(() => {
    testDb.close();
  });

  describe('teams_clear_checked_in_at_on_status', () => {
    it('should clear checked_in_at when status changes from checked_in to registered', async () => {
      // Create team
      const teamResult = await testDb.db.run(
        `INSERT INTO teams (event_id, team_number, team_name, status, checked_in_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [eventId, 101, 'Team 101', 'checked_in'],
      );
      const teamId = teamResult.lastID!;

      // Verify initial state
      let team = await testDb.db.get(`SELECT * FROM teams WHERE id = ?`, [
        teamId,
      ]);
      expect(team.status).toBe('checked_in');
      expect(team.checked_in_at).not.toBeNull();

      // Update status to registered
      await testDb.db.run(
        `UPDATE teams SET status = 'registered' WHERE id = ?`,
        [teamId],
      );

      // Verify checked_in_at is cleared
      team = await testDb.db.get(`SELECT * FROM teams WHERE id = ?`, [teamId]);
      expect(team.status).toBe('registered');
      expect(team.checked_in_at).toBeNull();
    });

    it('should clear checked_in_at when status changes to no_show', async () => {
      // Create team
      const teamResult = await testDb.db.run(
        `INSERT INTO teams (event_id, team_number, team_name, status, checked_in_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [eventId, 102, 'Team 102', 'checked_in'],
      );
      const teamId = teamResult.lastID!;

      // Update status to no_show
      await testDb.db.run(`UPDATE teams SET status = 'no_show' WHERE id = ?`, [
        teamId,
      ]);

      // Verify checked_in_at is cleared
      const team = await testDb.db.get(`SELECT * FROM teams WHERE id = ?`, [
        teamId,
      ]);
      expect(team.status).toBe('no_show');
      expect(team.checked_in_at).toBeNull();
    });

    it('should NOT clear checked_in_at when status changes to withdrawn', async () => {
      // Create team
      const teamResult = await testDb.db.run(
        `INSERT INTO teams (event_id, team_number, team_name, status, checked_in_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [eventId, 103, 'Team 103', 'checked_in'],
      );
      const teamId = teamResult.lastID!;

      // Update status to withdrawn
      await testDb.db.run(
        `UPDATE teams SET status = 'withdrawn' WHERE id = ?`,
        [teamId],
      );

      // Verify checked_in_at is preserved
      const team = await testDb.db.get(`SELECT * FROM teams WHERE id = ?`, [
        teamId,
      ]);
      expect(team.status).toBe('withdrawn');
      expect(team.checked_in_at).not.toBeNull();
    });
  });

  describe('game_queue_clear_called_at_on_queued', () => {
    it('should clear called_at when status changes from called to queued', async () => {
      // Create seeded item in queue
      const teamResult = await testDb.db.run(
        `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
        [eventId, 201, 'Team 201'],
      );

      const queueResult = await testDb.db.run(
        `INSERT INTO game_queue (event_id, queue_type, seeding_team_id, seeding_round, queue_position, status, called_at) 
         VALUES (?, 'seeding', ?, 1, 1, 'called', CURRENT_TIMESTAMP)`,
        [eventId, teamResult.lastID],
      );
      const queueId = queueResult.lastID!;

      // Verify initial state
      let item = await testDb.db.get(`SELECT * FROM game_queue WHERE id = ?`, [
        queueId,
      ]);
      expect(item.status).toBe('called');
      expect(item.called_at).not.toBeNull();

      // Update status to queued
      await testDb.db.run(
        `UPDATE game_queue SET status = 'queued' WHERE id = ?`,
        [queueId],
      );

      // Verify called_at is cleared
      item = await testDb.db.get(`SELECT * FROM game_queue WHERE id = ?`, [
        queueId,
      ]);
      expect(item.status).toBe('queued');
      expect(item.called_at).toBeNull();
    });

    it('should NOT clear called_at when status changes to in_progress or completed', async () => {
      // Create seeded item
      const teamResult = await testDb.db.run(
        `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
        [eventId, 202, 'Team 202'],
      );

      const queueResult = await testDb.db.run(
        `INSERT INTO game_queue (event_id, queue_type, seeding_team_id, seeding_round, queue_position, status, called_at) 
         VALUES (?, 'seeding', ?, 1, 1, 'called', CURRENT_TIMESTAMP)`,
        [eventId, teamResult.lastID],
      );
      const queueId = queueResult.lastID!;

      // Update to in_progress
      await testDb.db.run(
        `UPDATE game_queue SET status = 'in_progress' WHERE id = ?`,
        [queueId],
      );

      let item = await testDb.db.get(`SELECT * FROM game_queue WHERE id = ?`, [
        queueId,
      ]);
      expect(item.called_at).not.toBeNull();

      // Update to completed
      await testDb.db.run(
        `UPDATE game_queue SET status = 'completed' WHERE id = ?`,
        [queueId],
      );

      item = await testDb.db.get(`SELECT * FROM game_queue WHERE id = ?`, [
        queueId,
      ]);
      expect(item.called_at).not.toBeNull();
    });
  });

  describe('seeding_scores_clear_scored_at_when_score_null', () => {
    it('should clear scored_at when score is set to NULL', async () => {
      // Create team
      const teamResult = await testDb.db.run(
        `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
        [eventId, 301, 'Team 301'],
      );
      const teamId = teamResult.lastID!;

      // Create score
      const scoreResult = await testDb.db.run(
        `INSERT INTO seeding_scores (team_id, round_number, score, scored_at) 
         VALUES (?, 1, 100, CURRENT_TIMESTAMP)`,
        [teamId],
      );
      const scoreId = scoreResult.lastID!;

      // Verify initial state
      let score = await testDb.db.get(
        `SELECT * FROM seeding_scores WHERE id = ?`,
        [scoreId],
      );
      expect(score.score).toBe(100);
      expect(score.scored_at).not.toBeNull();

      // Update score to NULL
      await testDb.db.run(
        `UPDATE seeding_scores SET score = NULL WHERE id = ?`,
        [scoreId],
      );

      // Verify scored_at is cleared
      score = await testDb.db.get(`SELECT * FROM seeding_scores WHERE id = ?`, [
        scoreId,
      ]);
      expect(score.score).toBeNull();
      expect(score.scored_at).toBeNull();
    });
  });

  describe('bracket_games_clear_times_on_status_rollback', () => {
    let bracketId: number;

    beforeEach(async () => {
      const bracketResult = await testDb.db.run(
        `INSERT INTO brackets (event_id, name, bracket_size) VALUES (?, ?, ?)`,
        [eventId, 'Test Bracket', 4],
      );
      bracketId = bracketResult.lastID!;
    });

    it('should clear started_at and completed_at when rolled back to ready', async () => {
      // Create completed game
      const gameResult = await testDb.db.run(
        `INSERT INTO bracket_games (bracket_id, game_number, status, started_at, completed_at) 
         VALUES (?, 1, 'completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [bracketId],
      );
      const gameId = gameResult.lastID!;

      // Verify initial state
      let game = await testDb.db.get(
        `SELECT * FROM bracket_games WHERE id = ?`,
        [gameId],
      );
      expect(game.status).toBe('completed');
      expect(game.started_at).not.toBeNull();
      expect(game.completed_at).not.toBeNull();

      // Rollback to ready
      await testDb.db.run(
        `UPDATE bracket_games SET status = 'ready' WHERE id = ?`,
        [gameId],
      );

      // Verify timestamps cleared
      game = await testDb.db.get(`SELECT * FROM bracket_games WHERE id = ?`, [
        gameId,
      ]);
      expect(game.status).toBe('ready');
      expect(game.started_at).toBeNull();
      expect(game.completed_at).toBeNull();
    });

    it('should clear completed_at when rolled back to in_progress', async () => {
      // Create completed game
      const gameResult = await testDb.db.run(
        `INSERT INTO bracket_games (bracket_id, game_number, status, started_at, completed_at) 
         VALUES (?, 2, 'completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [bracketId],
      );
      const gameId = gameResult.lastID!;

      // Rollback to in_progress
      await testDb.db.run(
        `UPDATE bracket_games SET status = 'in_progress' WHERE id = ?`,
        [gameId],
      );

      // Verify only completed_at is cleared
      const game = await testDb.db.get(
        `SELECT * FROM bracket_games WHERE id = ?`,
        [gameId],
      );
      expect(game.status).toBe('in_progress');
      expect(game.started_at).not.toBeNull(); // Should preserve started_at
      expect(game.completed_at).toBeNull();
    });
  });
});
