import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { createEvent } from '../../../src/server/usecases/createEvent';
import { seedUser } from '../../http/helpers/seed';

describe('createEvent', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns 400 when name is missing', async () => {
    const result = await createEvent({
      db: testDb.db,
      body: {},
      userId: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe('Event name is required');
    }
  });

  it('inserts a new event with defaults applied', async () => {
    const user = await seedUser(testDb.db, { is_admin: true });
    const result = await createEvent({
      db: testDb.db,
      body: { name: 'New Event' },
      userId: user.id,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const ev = result.event as {
        name: string;
        status: string;
        seeding_rounds: number;
        score_accept_mode: string;
        created_by: number;
      };
      expect(ev.name).toBe('New Event');
      expect(ev.status).toBe('setup');
      expect(ev.seeding_rounds).toBe(3);
      expect(ev.score_accept_mode).toBe('manual');
      expect(ev.created_by).toBe(user.id);
    }
  });
});
