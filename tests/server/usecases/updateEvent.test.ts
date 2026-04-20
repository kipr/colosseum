import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { updateEvent } from '../../../src/server/usecases/updateEvent';
import { seedEvent } from '../../http/helpers/seed';

describe('updateEvent', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns 400 when no allowed fields are provided', async () => {
    const event = await seedEvent(testDb.db);
    const result = await updateEvent({
      db: testDb.db,
      eventId: event.id,
      body: { totally_unknown_field: 'x' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe('No valid fields to update');
    }
  });

  it('returns 404 when the event does not exist', async () => {
    const result = await updateEvent({
      db: testDb.db,
      eventId: 9999,
      body: { name: 'X' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });

  it('updates allowed fields and ignores unknown ones', async () => {
    const event = await seedEvent(testDb.db, { name: 'Old' });
    const result = await updateEvent({
      db: testDb.db,
      eventId: event.id,
      body: { name: 'New', not_allowed: 'ignored' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.event as { name: string }).name).toBe('New');
    }
  });

  it('auto-clears spectator_results_released when status moves away from complete', async () => {
    const event = await seedEvent(testDb.db, { status: 'complete' });
    await testDb.db.run(
      'UPDATE events SET spectator_results_released = 1 WHERE id = ?',
      [event.id],
    );

    const result = await updateEvent({
      db: testDb.db,
      eventId: event.id,
      body: { status: 'active' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const ev = result.event as {
        status: string;
        spectator_results_released: boolean | number;
      };
      expect(ev.status).toBe('active');
      // Booleans come back as `false` (or 0); both are falsy.
      expect(!!ev.spectator_results_released).toBe(false);
    }
  });

  it('does not auto-clear when caller explicitly sets spectator_results_released', async () => {
    const event = await seedEvent(testDb.db, { status: 'complete' });
    await testDb.db.run(
      'UPDATE events SET spectator_results_released = 1 WHERE id = ?',
      [event.id],
    );

    const result = await updateEvent({
      db: testDb.db,
      eventId: event.id,
      body: { status: 'active', spectator_results_released: 1 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        !!(result.event as { spectator_results_released: boolean | number })
          .spectator_results_released,
      ).toBe(true);
    }
  });
});
