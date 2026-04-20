/**
 * Direct tests for the `listEvents` use case. HTTP wiring is exercised in
 * `tests/http/events.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { listEvents } from '../../../src/server/usecases/listEvents';
import { seedEvent } from '../../http/helpers/seed';

describe('listEvents', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns an empty list when no events exist', async () => {
    const result = await listEvents({ db: testDb.db });
    expect(result.events).toEqual([]);
  });

  it('returns all events without a status filter', async () => {
    await seedEvent(testDb.db, { name: 'A', status: 'setup' });
    await seedEvent(testDb.db, { name: 'B', status: 'active' });

    const result = await listEvents({ db: testDb.db });
    expect(result.events.length).toBe(2);
  });

  it('filters by status when provided', async () => {
    await seedEvent(testDb.db, { name: 'Setup', status: 'setup' });
    await seedEvent(testDb.db, { name: 'Active', status: 'active' });

    const result = await listEvents({ db: testDb.db, status: 'active' });
    expect(result.events.length).toBe(1);
    expect((result.events[0] as { name: string }).name).toBe('Active');
  });
});
