import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { listPublicEvents } from '../../../src/server/usecases/listPublicEvents';
import { seedEvent } from '../../http/helpers/seed';

describe('listPublicEvents', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('hides archived events from spectators', async () => {
    await seedEvent(testDb.db, { name: 'Visible', status: 'active' });
    await seedEvent(testDb.db, { name: 'Hidden', status: 'archived' });

    const result = await listPublicEvents({ db: testDb.db });
    expect(result.events.length).toBe(1);
    expect(result.events[0].name).toBe('Visible');
  });

  it('emits the public projection (no spectator_results_released field)', async () => {
    await seedEvent(testDb.db, { name: 'Done', status: 'complete' });

    const result = await listPublicEvents({ db: testDb.db });
    expect(result.events.length).toBe(1);
    const ev = result.events[0] as Record<string, unknown>;
    expect(ev).not.toHaveProperty('spectator_results_released');
    expect(ev).toHaveProperty('final_scores_available', false);
  });
});
