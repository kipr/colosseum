/**
 * Schema and constraint tests - verify that database constraints work correctly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from './helpers/testDb';

describe('Schema Constraints', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  describe('teams table', () => {
    it('should enforce UNIQUE(event_id, team_number)', async () => {
      // Create an event first
      const eventResult = await testDb.db.run(
        `INSERT INTO events (name, status) VALUES (?, ?)`,
        ['Test Event', 'setup'],
      );
      const eventId = eventResult.lastID!;

      // Insert first team
      await testDb.db.run(
        `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
        [eventId, 100, 'Team Alpha'],
      );

      // Try to insert duplicate team_number for same event - should fail
      await expect(
        testDb.db.run(
          `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
          [eventId, 100, 'Team Beta'],
        ),
      ).rejects.toThrow(/UNIQUE constraint failed/);
    });

    it('should allow same team_number in different events', async () => {
      // Create two events
      const event1 = await testDb.db.run(
        `INSERT INTO events (name, status) VALUES (?, ?)`,
        ['Event 1', 'setup'],
      );
      const event2 = await testDb.db.run(
        `INSERT INTO events (name, status) VALUES (?, ?)`,
        ['Event 2', 'setup'],
      );

      // Same team_number in different events should be allowed
      await testDb.db.run(
        `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
        [event1.lastID, 100, 'Team in Event 1'],
      );
      await testDb.db.run(
        `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
        [event2.lastID, 100, 'Team in Event 2'],
      );

      // Verify both exist
      const teams = await testDb.db.all(`SELECT * FROM teams`);
      expect(teams).toHaveLength(2);
    });

    it('should enforce CHECK(team_number > 0)', async () => {
      const eventResult = await testDb.db.run(
        `INSERT INTO events (name, status) VALUES (?, ?)`,
        ['Test Event', 'setup'],
      );

      // team_number = 0 should fail
      await expect(
        testDb.db.run(
          `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
          [eventResult.lastID, 0, 'Invalid Team'],
        ),
      ).rejects.toThrow(/CHECK constraint failed/);

      // Negative team_number should fail
      await expect(
        testDb.db.run(
          `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
          [eventResult.lastID, -1, 'Invalid Team'],
        ),
      ).rejects.toThrow(/CHECK constraint failed/);
    });

    it('should enforce CHECK on status values', async () => {
      const eventResult = await testDb.db.run(
        `INSERT INTO events (name, status) VALUES (?, ?)`,
        ['Test Event', 'setup'],
      );

      // Invalid status should fail
      await expect(
        testDb.db.run(
          `INSERT INTO teams (event_id, team_number, team_name, status) VALUES (?, ?, ?, ?)`,
          [eventResult.lastID, 1, 'Team', 'invalid_status'],
        ),
      ).rejects.toThrow(/CHECK constraint failed/);

      // Valid statuses should work
      for (const status of [
        'registered',
        'checked_in',
        'no_show',
        'withdrawn',
      ]) {
        await testDb.db.run(
          `INSERT INTO teams (event_id, team_number, team_name, status) VALUES (?, ?, ?, ?)`,
          [
            eventResult.lastID,
            Math.floor(Math.random() * 10000) + 1,
            `Team ${status}`,
            status,
          ],
        );
      }
    });
  });

  describe('bracket_entries table', () => {
    let eventId: number;
    let bracketId: number;
    let teamId: number;

    beforeEach(async () => {
      // Create event, bracket, and team for testing
      const eventResult = await testDb.db.run(
        `INSERT INTO events (name, status) VALUES (?, ?)`,
        ['Test Event', 'setup'],
      );
      eventId = eventResult.lastID!;

      const bracketResult = await testDb.db.run(
        `INSERT INTO brackets (event_id, name, bracket_size) VALUES (?, ?, ?)`,
        [eventId, 'Test Bracket', 8],
      );
      bracketId = bracketResult.lastID!;

      const teamResult = await testDb.db.run(
        `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
        [eventId, 100, 'Test Team'],
      );
      teamId = teamResult.lastID!;
    });

    it('should enforce CHECK: bye requires null team_id', async () => {
      // is_bye=1 with team_id should fail
      await expect(
        testDb.db.run(
          `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye) VALUES (?, ?, ?, ?)`,
          [bracketId, teamId, 1, 1],
        ),
      ).rejects.toThrow(/CHECK constraint failed/);
    });

    it('should enforce CHECK: non-bye requires team_id', async () => {
      // is_bye=0 with null team_id should fail
      await expect(
        testDb.db.run(
          `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye) VALUES (?, ?, ?, ?)`,
          [bracketId, null, 1, 0],
        ),
      ).rejects.toThrow(/CHECK constraint failed/);
    });

    it('should allow valid bye entry (is_bye=1, team_id=null)', async () => {
      await testDb.db.run(
        `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye) VALUES (?, ?, ?, ?)`,
        [bracketId, null, 1, 1],
      );

      const entry = await testDb.db.get(
        `SELECT * FROM bracket_entries WHERE bracket_id = ?`,
        [bracketId],
      );
      expect(entry).toBeDefined();
      expect(entry.is_bye).toBe(1);
      expect(entry.team_id).toBeNull();
    });

    it('should allow valid team entry (is_bye=0, team_id set)', async () => {
      await testDb.db.run(
        `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye) VALUES (?, ?, ?, ?)`,
        [bracketId, teamId, 1, 0],
      );

      const entry = await testDb.db.get(
        `SELECT * FROM bracket_entries WHERE bracket_id = ?`,
        [bracketId],
      );
      expect(entry).toBeDefined();
      expect(entry.is_bye).toBe(0);
      expect(entry.team_id).toBe(teamId);
    });

    it('should enforce UNIQUE(bracket_id, seed_position)', async () => {
      await testDb.db.run(
        `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye) VALUES (?, ?, ?, ?)`,
        [bracketId, teamId, 1, 0],
      );

      // Create another team
      const team2Result = await testDb.db.run(
        `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
        [eventId, 200, 'Team 2'],
      );

      // Same seed_position in same bracket should fail
      await expect(
        testDb.db.run(
          `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye) VALUES (?, ?, ?, ?)`,
          [bracketId, team2Result.lastID, 1, 0],
        ),
      ).rejects.toThrow(/UNIQUE constraint failed/);
    });
  });

  describe('game_queue table', () => {
    let eventId: number;
    let bracketId: number;
    let teamId: number;
    let gameId: number;

    beforeEach(async () => {
      const eventResult = await testDb.db.run(
        `INSERT INTO events (name, status) VALUES (?, ?)`,
        ['Test Event', 'setup'],
      );
      eventId = eventResult.lastID!;

      const bracketResult = await testDb.db.run(
        `INSERT INTO brackets (event_id, name, bracket_size) VALUES (?, ?, ?)`,
        [eventId, 'Test Bracket', 8],
      );
      bracketId = bracketResult.lastID!;

      const teamResult = await testDb.db.run(
        `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
        [eventId, 100, 'Test Team'],
      );
      teamId = teamResult.lastID!;

      const gameResult = await testDb.db.run(
        `INSERT INTO bracket_games (bracket_id, game_number) VALUES (?, ?)`,
        [bracketId, 1],
      );
      gameId = gameResult.lastID!;
    });

    it('should enforce CHECK: bracket queue requires bracket_game_id', async () => {
      // queue_type='bracket' without bracket_game_id should fail
      await expect(
        testDb.db.run(
          `INSERT INTO game_queue (event_id, queue_type, queue_position, bracket_game_id, seeding_team_id, seeding_round)
           VALUES (?, 'bracket', 1, NULL, NULL, NULL)`,
          [eventId],
        ),
      ).rejects.toThrow(/CHECK constraint failed/);
    });

    it('should enforce CHECK: seeding queue requires seeding_team_id and seeding_round', async () => {
      // queue_type='seeding' without seeding_team_id should fail
      await expect(
        testDb.db.run(
          `INSERT INTO game_queue (event_id, queue_type, queue_position, bracket_game_id, seeding_team_id, seeding_round)
           VALUES (?, 'seeding', 1, NULL, NULL, 1)`,
          [eventId],
        ),
      ).rejects.toThrow(/CHECK constraint failed/);

      // queue_type='seeding' without seeding_round should fail
      await expect(
        testDb.db.run(
          `INSERT INTO game_queue (event_id, queue_type, queue_position, bracket_game_id, seeding_team_id, seeding_round)
           VALUES (?, 'seeding', 1, NULL, ?, NULL)`,
          [eventId, teamId],
        ),
      ).rejects.toThrow(/CHECK constraint failed/);
    });

    it('should allow valid bracket queue entry', async () => {
      await testDb.db.run(
        `INSERT INTO game_queue (event_id, queue_type, queue_position, bracket_game_id, seeding_team_id, seeding_round)
         VALUES (?, 'bracket', 1, ?, NULL, NULL)`,
        [eventId, gameId],
      );

      const entry = await testDb.db.get(
        `SELECT * FROM game_queue WHERE event_id = ?`,
        [eventId],
      );
      expect(entry.queue_type).toBe('bracket');
      expect(entry.bracket_game_id).toBe(gameId);
    });

    it('should allow valid seeding queue entry', async () => {
      await testDb.db.run(
        `INSERT INTO game_queue (event_id, queue_type, queue_position, bracket_game_id, seeding_team_id, seeding_round)
         VALUES (?, 'seeding', 1, NULL, ?, 2)`,
        [eventId, teamId],
      );

      const entry = await testDb.db.get(
        `SELECT * FROM game_queue WHERE event_id = ?`,
        [eventId],
      );
      expect(entry.queue_type).toBe('seeding');
      expect(entry.seeding_team_id).toBe(teamId);
      expect(entry.seeding_round).toBe(2);
    });
  });

  describe('events table', () => {
    it('should enforce CHECK on status values', async () => {
      // Invalid status should fail
      await expect(
        testDb.db.run(`INSERT INTO events (name, status) VALUES (?, ?)`, [
          'Test Event',
          'invalid_status',
        ]),
      ).rejects.toThrow(/CHECK constraint failed/);

      // Valid statuses should work
      for (const status of ['setup', 'active', 'complete', 'archived']) {
        await testDb.db.run(`INSERT INTO events (name, status) VALUES (?, ?)`, [
          `Event ${status}`,
          status,
        ]);
      }

      const events = await testDb.db.all(`SELECT * FROM events`);
      expect(events).toHaveLength(4);
    });
  });

  describe('foreign key constraints', () => {
    it('should enforce teams.event_id references events.id', async () => {
      // Insert team with non-existent event_id should fail
      await expect(
        testDb.db.run(
          `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
          [99999, 1, 'Orphan Team'],
        ),
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    });

    it('should cascade delete teams when event is deleted', async () => {
      const eventResult = await testDb.db.run(
        `INSERT INTO events (name, status) VALUES (?, ?)`,
        ['Test Event', 'setup'],
      );

      await testDb.db.run(
        `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
        [eventResult.lastID, 1, 'Test Team'],
      );

      // Verify team exists
      let teams = await testDb.db.all(`SELECT * FROM teams`);
      expect(teams).toHaveLength(1);

      // Delete event
      await testDb.db.run(`DELETE FROM events WHERE id = ?`, [
        eventResult.lastID,
      ]);

      // Team should be deleted too (CASCADE)
      teams = await testDb.db.all(`SELECT * FROM teams`);
      expect(teams).toHaveLength(0);
    });
  });
});
