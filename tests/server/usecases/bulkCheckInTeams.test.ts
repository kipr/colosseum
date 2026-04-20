import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { bulkCheckInTeams } from '../../../src/server/usecases/bulkCheckInTeams';
import { seedEvent, seedTeam } from '../../http/helpers/seed';

describe('bulkCheckInTeams', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns 400 when team_numbers is missing or empty', async () => {
    const event = await seedEvent(testDb.db);
    const result = await bulkCheckInTeams({
      db: testDb.db,
      eventId: event.id,
      body: {},
      userId: null,
      ipAddress: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns 400 when event does not exist', async () => {
    const result = await bulkCheckInTeams({
      db: testDb.db,
      eventId: 9999,
      body: { team_numbers: [1] },
      userId: null,
      ipAddress: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe('Event does not exist');
    }
  });

  it('checks in matching teams and reports unmatched numbers', async () => {
    const event = await seedEvent(testDb.db);
    await seedTeam(testDb.db, { event_id: event.id, team_number: 1 });
    await seedTeam(testDb.db, { event_id: event.id, team_number: 2 });

    const result = await bulkCheckInTeams({
      db: testDb.db,
      eventId: event.id,
      body: { team_numbers: [1, 2, 999] },
      userId: null,
      ipAddress: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.updated).toBe(2);
      expect(result.not_found).toEqual([999]);
    }
  });
});
