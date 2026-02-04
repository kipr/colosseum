/**
 * Smoke test to verify the test database harness works correctly.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb, TestDb } from './helpers/testDb';

describe('Test DB Harness', () => {
  let testDb: TestDb;

  afterEach(() => {
    if (testDb) {
      testDb.close();
    }
  });

  it('should create an in-memory database with schema', async () => {
    testDb = await createTestDb();

    // Verify some key tables exist
    const tables = await testDb.db.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
    );

    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('events');
    expect(tableNames).toContain('teams');
    expect(tableNames).toContain('brackets');
    expect(tableNames).toContain('bracket_games');
    expect(tableNames).toContain('bracket_entries');
    expect(tableNames).toContain('seeding_scores');
    expect(tableNames).toContain('seeding_rankings');
    expect(tableNames).toContain('game_queue');
    expect(tableNames).toContain('bracket_templates');
    expect(tableNames).toContain('audit_log');
  });

  it('should allow basic CRUD operations', async () => {
    testDb = await createTestDb();

    // Insert an event
    const result = await testDb.db.run(
      `INSERT INTO events (name, status) VALUES (?, ?)`,
      ['Test Event', 'setup'],
    );
    expect(result.lastID).toBeGreaterThan(0);

    // Query the event
    const event = await testDb.db.get<{ id: number; name: string }>(
      `SELECT * FROM events WHERE id = ?`,
      [result.lastID],
    );
    expect(event).toBeDefined();
    expect(event?.name).toBe('Test Event');
  });
});
