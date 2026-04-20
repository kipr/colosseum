import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { deleteEvent } from '../../../src/server/usecases/deleteEvent';
import { seedEvent } from '../../http/helpers/seed';

describe('deleteEvent', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('removes an existing event', async () => {
    const event = await seedEvent(testDb.db);
    const result = await deleteEvent({ db: testDb.db, eventId: event.id });
    expect(result.ok).toBe(true);

    const row = await testDb.db.get('SELECT id FROM events WHERE id = ?', [
      event.id,
    ]);
    expect(row).toBeUndefined();
  });

  it('is idempotent when the event does not exist', async () => {
    const result = await deleteEvent({ db: testDb.db, eventId: 9999 });
    expect(result.ok).toBe(true);
  });
});
