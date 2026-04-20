import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { listTeams } from '../../../src/server/usecases/listTeams';
import { seedEvent, seedTeam } from '../../http/helpers/seed';

describe('listTeams', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns teams ordered by team_number', async () => {
    const event = await seedEvent(testDb.db);
    await seedTeam(testDb.db, { event_id: event.id, team_number: 20 });
    await seedTeam(testDb.db, { event_id: event.id, team_number: 10 });

    const result = await listTeams({ db: testDb.db, eventId: event.id });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.teams.map((t) => (t as { team_number: number }).team_number),
      ).toEqual([10, 20]);
    }
  });

  it('filters by status when provided', async () => {
    const event = await seedEvent(testDb.db);
    await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
      status: 'registered',
    });
    await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 2,
      status: 'checked_in',
    });

    const result = await listTeams({
      db: testDb.db,
      eventId: event.id,
      status: 'checked_in',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.teams.length).toBe(1);
      expect((result.teams[0] as { team_number: number }).team_number).toBe(2);
    }
  });

  it('returns 404 for archived events', async () => {
    const event = await seedEvent(testDb.db, { status: 'archived' });
    const result = await listTeams({ db: testDb.db, eventId: event.id });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });
});
