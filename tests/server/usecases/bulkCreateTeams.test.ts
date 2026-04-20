import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { bulkCreateTeams } from '../../../src/server/usecases/bulkCreateTeams';
import { seedEvent, seedTeam } from '../../http/helpers/seed';

describe('bulkCreateTeams', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns 400 when payload is empty', async () => {
    const result = await bulkCreateTeams({
      db: testDb.db,
      body: { event_id: 1, teams: [] },
      userId: null,
      ipAddress: null,
    });
    expect(result.ok).toBe(false);
  });

  it('returns 400 when event does not exist', async () => {
    const result = await bulkCreateTeams({
      db: testDb.db,
      body: { event_id: 9999, teams: [{ team_number: 1, team_name: 'A' }] },
      userId: null,
      ipAddress: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe('Event does not exist');
    }
  });

  it('inserts valid teams and reports per-row errors', async () => {
    const event = await seedEvent(testDb.db);
    await seedTeam(testDb.db, { event_id: event.id, team_number: 5 });

    const result = await bulkCreateTeams({
      db: testDb.db,
      body: {
        event_id: event.id,
        teams: [
          { team_number: 1, team_name: 'One' },
          { team_number: 1, team_name: 'Dup-in-payload' },
          { team_name: 'Missing number' },
          { team_number: 5, team_name: 'Already exists' },
          { team_number: 2, team_name: 'Two' },
        ],
      },
      userId: null,
      ipAddress: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.created).toBe(2);
      expect(result.errors?.length).toBe(3);
    }
  });
});
