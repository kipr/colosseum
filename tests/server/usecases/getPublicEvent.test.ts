import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { getPublicEvent } from '../../../src/server/usecases/getPublicEvent';
import { seedEvent } from '../../http/helpers/seed';

describe('getPublicEvent', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns the public projection when the event is visible', async () => {
    const event = await seedEvent(testDb.db, {
      name: 'Visible Event',
      status: 'active',
    });

    const result = await getPublicEvent({ db: testDb.db, eventId: event.id });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.name).toBe('Visible Event');
      expect(result.event.final_scores_available).toBe(false);
    }
  });

  it('returns 404 when the event is archived', async () => {
    const event = await seedEvent(testDb.db, { status: 'archived' });

    const result = await getPublicEvent({ db: testDb.db, eventId: event.id });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });

  it('returns 404 when the event does not exist', async () => {
    const result = await getPublicEvent({ db: testDb.db, eventId: 9999 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });
});
