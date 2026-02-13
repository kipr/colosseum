/**
 * Transaction behavior tests - verify commit and rollback semantics.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from './helpers/testDb';
import { normalizeParam } from '../../src/server/database/connection';

describe('Transaction Behavior', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it('should commit all writes when transaction succeeds', async () => {
    // Create an event first
    const eventResult = await testDb.db.run(
      `INSERT INTO events (name, status) VALUES (?, ?)`,
      ['Test Event', 'setup'],
    );
    const eventId = eventResult.lastID!;

    // Insert multiple teams in a transaction
    await testDb.db.transaction((tx) => {
      tx.run(
        `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
        [eventId, 100, 'Team A'],
      );
      tx.run(
        `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
        [eventId, 200, 'Team B'],
      );
      tx.run(
        `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
        [eventId, 300, 'Team C'],
      );
    });

    // All teams should be present
    const teams = await testDb.db.all(
      `SELECT * FROM teams ORDER BY team_number`,
    );
    expect(teams).toHaveLength(3);
    expect(teams[0].team_number).toBe(100);
    expect(teams[1].team_number).toBe(200);
    expect(teams[2].team_number).toBe(300);
  });

  it('should rollback all writes when transaction throws', async () => {
    // Create an event first
    const eventResult = await testDb.db.run(
      `INSERT INTO events (name, status) VALUES (?, ?)`,
      ['Test Event', 'setup'],
    );
    const eventId = eventResult.lastID!;

    // Insert one team outside transaction
    await testDb.db.run(
      `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
      [eventId, 50, 'Pre-existing Team'],
    );

    // Transaction that inserts some teams then throws
    await expect(
      testDb.db.transaction((tx) => {
        tx.run(
          `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
          [eventId, 100, 'Team A'],
        );
        tx.run(
          `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
          [eventId, 200, 'Team B'],
        );

        // Throw an error mid-transaction
        throw new Error('Intentional rollback test');
      }),
    ).rejects.toThrow('Intentional rollback test');

    // Only the pre-existing team should remain
    const teams = await testDb.db.all(`SELECT * FROM teams`);
    expect(teams).toHaveLength(1);
    expect(teams[0].team_number).toBe(50);
  });

  it('should rollback on constraint violation within transaction', async () => {
    // Create an event
    const eventResult = await testDb.db.run(
      `INSERT INTO events (name, status) VALUES (?, ?)`,
      ['Test Event', 'setup'],
    );
    const eventId = eventResult.lastID!;

    // Transaction that violates UNIQUE constraint
    await expect(
      testDb.db.transaction((tx) => {
        tx.run(
          `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
          [eventId, 100, 'Team A'],
        );
        // Duplicate team_number should cause constraint violation
        tx.run(
          `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
          [eventId, 100, 'Team B'],
        );
      }),
    ).rejects.toThrow(/UNIQUE constraint failed/);

    // Neither team should exist
    const teams = await testDb.db.all(`SELECT * FROM teams`);
    expect(teams).toHaveLength(0);
  });

  it('should return value from transaction callback', async () => {
    const eventResult = await testDb.db.run(
      `INSERT INTO events (name, status) VALUES (?, ?)`,
      ['Test Event', 'setup'],
    );
    const eventId = eventResult.lastID!;

    // Transaction that returns a value
    const result = await testDb.db.transaction((tx) => {
      const r1 = tx.run(
        `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
        [eventId, 100, 'Team A'],
      );
      const r2 = tx.run(
        `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
        [eventId, 200, 'Team B'],
      );
      return { team1Id: r1.lastID, team2Id: r2.lastID };
    });

    expect(result.team1Id).toBeGreaterThan(0);
    expect(result.team2Id).toBeGreaterThan(0);
    expect(result.team2Id).toBeGreaterThan(result.team1Id);
  });

  it('should handle empty transaction', async () => {
    // Empty transaction should succeed
    const result = await testDb.db.transaction(() => {
      return 'success';
    });
    expect(result).toBe('success');
  });

  it('should handle nested data manipulation in transaction', async () => {
    const eventResult = await testDb.db.run(
      `INSERT INTO events (name, status, seeding_rounds) VALUES (?, ?, ?)`,
      ['Test Event', 'setup', 3],
    );
    const eventId = eventResult.lastID!;

    // Complex transaction with multiple related inserts
    await testDb.db.transaction((tx) => {
      // Create teams
      const team1 = tx.run(
        `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
        [eventId, 100, 'Team A'],
      );
      const team2 = tx.run(
        `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
        [eventId, 200, 'Team B'],
      );

      // Create seeding scores for teams
      tx.run(
        `INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, ?, ?)`,
        [team1.lastID, 1, 150],
      );
      tx.run(
        `INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, ?, ?)`,
        [team2.lastID, 1, 120],
      );
    });

    // Verify all data was committed
    const teams = await testDb.db.all(`SELECT * FROM teams`);
    const scores = await testDb.db.all(`SELECT * FROM seeding_scores`);

    expect(teams).toHaveLength(2);
    expect(scores).toHaveLength(2);
  });
});

describe('normalizeParam', () => {
  it('should convert undefined to null', () => {
    expect(normalizeParam(undefined)).toBeNull();
  });

  it('should preserve null', () => {
    expect(normalizeParam(null)).toBeNull();
  });

  it('should convert Date to ISO string', () => {
    const date = new Date('2024-01-15T10:30:00Z');
    expect(normalizeParam(date)).toBe('2024-01-15T10:30:00.000Z');
  });

  it('should convert boolean true to 1', () => {
    expect(normalizeParam(true)).toBe(1);
  });

  it('should convert boolean false to 0', () => {
    expect(normalizeParam(false)).toBe(0);
  });

  it('should preserve numbers', () => {
    expect(normalizeParam(42)).toBe(42);
    expect(normalizeParam(3.14)).toBe(3.14);
    expect(normalizeParam(-100)).toBe(-100);
  });

  it('should preserve strings', () => {
    expect(normalizeParam('hello')).toBe('hello');
    expect(normalizeParam('')).toBe('');
  });

  it('should preserve bigint', () => {
    const big = 9007199254740993n;
    expect(normalizeParam(big)).toBe(big);
  });

  it('should JSON stringify objects', () => {
    const obj = { foo: 'bar', count: 42 };
    expect(normalizeParam(obj)).toBe('{"foo":"bar","count":42}');
  });

  it('should JSON stringify arrays', () => {
    const arr = [1, 2, 3];
    expect(normalizeParam(arr)).toBe('[1,2,3]');
  });
});
