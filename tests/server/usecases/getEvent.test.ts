import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { getEvent } from '../../../src/server/usecases/getEvent';
import { seedEvent } from '../../http/helpers/seed';

describe('getEvent', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns the full row when found', async () => {
    const event = await seedEvent(testDb.db, { name: 'My Event' });
    const result = await getEvent({ db: testDb.db, eventId: event.id });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.event as { id: number; name: string }).name).toBe(
        'My Event',
      );
    }
  });

  it('returns 404 when not found', async () => {
    const result = await getEvent({ db: testDb.db, eventId: 9999 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error).toBe('Event not found');
    }
  });
});
