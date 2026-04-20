import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { checkInTeam } from '../../../src/server/usecases/checkInTeam';
import { seedEvent, seedTeam } from '../../http/helpers/seed';

describe('checkInTeam', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('marks the team as checked_in', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    const result = await checkInTeam({
      db: testDb.db,
      teamId: team.id,
      userId: null,
      ipAddress: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.team as { status: string }).status).toBe('checked_in');
      expect(
        (result.team as { checked_in_at: unknown }).checked_in_at,
      ).not.toBe(null);
    }
  });

  it('returns 404 when the team is missing', async () => {
    const result = await checkInTeam({
      db: testDb.db,
      teamId: 9999,
      userId: null,
      ipAddress: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});
