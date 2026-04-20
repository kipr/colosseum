import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { deleteTeam } from '../../../src/server/usecases/deleteTeam';
import { seedEvent, seedTeam } from '../../http/helpers/seed';

describe('deleteTeam', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('removes the team', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    const result = await deleteTeam({
      db: testDb.db,
      teamId: team.id,
      userId: null,
      ipAddress: null,
    });
    expect(result.ok).toBe(true);

    const after = await testDb.db.get('SELECT id FROM teams WHERE id = ?', [
      team.id,
    ]);
    expect(after).toBeFalsy();
  });

  it('is idempotent for missing teams', async () => {
    const result = await deleteTeam({
      db: testDb.db,
      teamId: 9999,
      userId: null,
      ipAddress: null,
    });
    expect(result.ok).toBe(true);
  });
});
