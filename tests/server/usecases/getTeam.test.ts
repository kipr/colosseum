import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { getTeam } from '../../../src/server/usecases/getTeam';
import { seedEvent, seedTeam } from '../../http/helpers/seed';

describe('getTeam', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns the row when found', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 7,
    });
    const result = await getTeam({ db: testDb.db, teamId: team.id });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.team as { team_number: number }).team_number).toBe(7);
    }
  });

  it('returns 404 when not found', async () => {
    const result = await getTeam({ db: testDb.db, teamId: 9999 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error).toBe('Team not found');
    }
  });
});
