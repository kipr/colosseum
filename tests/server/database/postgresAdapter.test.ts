/**
 * PostgresAdapter behaviour against a real PostgreSQL server.
 *
 * These tests pin placeholder conversion, explicit RETURNING / lastID,
 * transaction semantics, and the result types pg returns.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';

describe('PostgresAdapter', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  async function seedEventId(name = 'Adapter Event'): Promise<number> {
    const result = await testDb.db.run(
      'INSERT INTO events (name) VALUES (?) RETURNING id',
      [name],
    );
    return result.lastID!;
  }

  describe('placeholder conversion', () => {
    it('converts each ? to a positional parameter in order', async () => {
      await testDb.db.run(
        `INSERT INTO events (name, location, seeding_rounds) VALUES (?, ?, ?) RETURNING id`,
        ['Ordered', 'Arena', 4],
      );

      const row = await testDb.db.get<{
        name: string;
        location: string;
        seeding_rounds: number;
      }>(
        'SELECT name, location, seeding_rounds FROM events WHERE name = ? AND location = ?',
        ['Ordered', 'Arena'],
      );

      expect(row).toMatchObject({
        name: 'Ordered',
        location: 'Arena',
        seeding_rounds: 4,
      });
    });

    it('normalizes undefined to null and objects to JSON', async () => {
      const template = await testDb.db.run(
        `INSERT INTO scoresheet_templates (name, description, schema, access_code)
         VALUES (?, ?, ?, ?) RETURNING id`,
        ['Template', undefined, [{ id: 'a', type: 'number' }], 'CODE1'],
      );

      const row = await testDb.db.get<{
        description: string | null;
        schema: string;
      }>('SELECT description, schema FROM scoresheet_templates WHERE id = ?', [
        template.lastID,
      ]);

      expect(row?.description).toBeNull();
      expect(JSON.parse(row!.schema)).toEqual([{ id: 'a', type: 'number' }]);
    });
  });

  describe('lastID and changes', () => {
    it('reports lastID for tables with an id column', async () => {
      const first = await testDb.db.run(
        'INSERT INTO events (name) VALUES (?) RETURNING id',
        ['First'],
      );
      const second = await testDb.db.run(
        'INSERT INTO events (name) VALUES (?) RETURNING id',
        ['Second'],
      );

      expect(first.lastID).toBe(1);
      expect(second.lastID).toBe(2);
      expect(second.changes).toBe(1);
    });

    it('does not set lastID when the INSERT omits RETURNING', async () => {
      const result = await testDb.db.run(
        'INSERT INTO events (name) VALUES (?)',
        ['No Returning'],
      );

      expect(result.lastID).toBeUndefined();
      expect(result.changes).toBe(1);

      const row = await testDb.db.get<{ name: string }>(
        'SELECT name FROM events WHERE name = ?',
        ['No Returning'],
      );
      expect(row?.name).toBe('No Returning');
    });

    it('reports changes without lastID for tables keyed on another column', async () => {
      const eventId = await seedEventId();

      // queue_versions is keyed on event_id, so callers must not ask for
      // RETURNING id.
      const result = await testDb.db.run(
        `INSERT INTO queue_versions (event_id, version, dirty) VALUES (?, 1, 0)`,
        [eventId],
      );

      expect(result.lastID).toBeUndefined();
      expect(result.changes).toBe(1);

      const row = await testDb.db.get<{ version: number }>(
        'SELECT version FROM queue_versions WHERE event_id = ?',
        [eventId],
      );
      expect(row?.version).toBe(1);
    });

    it('counts affected rows for UPDATE and DELETE', async () => {
      await seedEventId('One');
      await seedEventId('Two');

      const updated = await testDb.db.run(
        `UPDATE events SET location = ? WHERE name IN (?, ?)`,
        ['Arena', 'One', 'Two'],
      );
      expect(updated.changes).toBe(2);

      const deleted = await testDb.db.run('DELETE FROM events WHERE name = ?', [
        'One',
      ]);
      expect(deleted.changes).toBe(1);

      const missing = await testDb.db.run('DELETE FROM events WHERE name = ?', [
        'Nonexistent',
      ]);
      expect(missing.changes).toBe(0);
    });
  });

  describe('transactions', () => {
    it('commits when the callback resolves', async () => {
      await testDb.db.transaction(async (tx) => {
        const event = await tx.run(
          'INSERT INTO events (name) VALUES (?) RETURNING id',
          ['Committed'],
        );
        await tx.run(
          'INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?) RETURNING id',
          [event.lastID, 1, 'Team One'],
        );
      });

      const teams = await testDb.db.all('SELECT * FROM teams');
      expect(teams).toHaveLength(1);
    });

    it('rolls back every statement when the callback throws', async () => {
      await expect(
        testDb.db.transaction(async (tx) => {
          await tx.run('INSERT INTO events (name) VALUES (?) RETURNING id', [
            'Rolled back',
          ]);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      const events = await testDb.db.all('SELECT * FROM events');
      expect(events).toEqual([]);
    });

    it('does not rewrite INSERT OR IGNORE', async () => {
      await expect(
        testDb.db.run('INSERT OR IGNORE INTO events (name) VALUES (?)', [
          'Ignored',
        ]),
      ).rejects.toThrow(/syntax error/);
    });

    it('surfaces the original constraint error from an INSERT in a transaction', async () => {
      const eventId = await seedEventId();
      await testDb.db.run(
        'INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?) RETURNING id',
        [eventId, 7, 'Original'],
      );

      await expect(
        testDb.db.transaction(async (tx) => {
          await tx.run(
            'INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?) RETURNING id',
            [eventId, 7, 'Duplicate'],
          );
        }),
      ).rejects.toThrow(/violates unique constraint/);
    });

    it('keeps a transaction usable after inserting into an id-less table', async () => {
      const eventId = await seedEventId();

      await testDb.db.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO queue_versions (event_id, version, dirty) VALUES (?, 1, 0)`,
          [eventId],
        );
        await tx.run('UPDATE events SET location = ? WHERE id = ?', [
          'Still working',
          eventId,
        ]);
      });

      const event = await testDb.db.get<{ location: string }>(
        'SELECT location FROM events WHERE id = ?',
        [eventId],
      );
      expect(event?.location).toBe('Still working');
    });
  });

  describe('result types', () => {
    it('returns booleans for boolean columns', async () => {
      const eventId = await seedEventId();
      const bracket = await testDb.db.run(
        'INSERT INTO brackets (event_id, name, bracket_size) VALUES (?, ?, ?) RETURNING id',
        [eventId, 'Main', 4],
      );
      await testDb.db.run(
        `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye)
         VALUES (?, NULL, ?, ?) RETURNING id`,
        [bracket.lastID, 1, true],
      );

      const entry = await testDb.db.get<{ is_bye: boolean }>(
        'SELECT is_bye FROM bracket_entries WHERE bracket_id = ?',
        [bracket.lastID],
      );
      expect(entry?.is_bye).toBe(true);
    });

    it('returns Date objects for timestamp columns', async () => {
      const eventId = await seedEventId();
      const row = await testDb.db.get<{ created_at: unknown }>(
        'SELECT created_at FROM events WHERE id = ?',
        [eventId],
      );
      expect(row?.created_at).toBeInstanceOf(Date);
    });

    it('returns COUNT(*) as a string', async () => {
      await testDb.db.run(
        `INSERT INTO users (google_id, email, name)
         VALUES (?, ?, ?) RETURNING id`,
        ['g-1', 'a@example.com', 'A'],
      );

      const counted = await testDb.db.get<{ count: string }>(
        'SELECT COUNT(*) AS count FROM users',
      );
      expect(typeof counted?.count).toBe('string');
      expect(Number(counted?.count)).toBe(1);
    });
  });
});
