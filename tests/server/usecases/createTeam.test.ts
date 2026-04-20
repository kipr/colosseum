import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { createTeam } from '../../../src/server/usecases/createTeam';
import { seedEvent, seedTeam } from '../../http/helpers/seed';

describe('createTeam', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns 400 when required fields are missing', async () => {
    const result = await createTeam({
      db: testDb.db,
      body: { event_id: 1 },
      userId: null,
      ipAddress: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('inserts and returns the team with derived display_name', async () => {
    const event = await seedEvent(testDb.db);
    const result = await createTeam({
      db: testDb.db,
      body: { event_id: event.id, team_number: 42, team_name: 'Robots' },
      userId: null,
      ipAddress: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.team as { team_number: number }).team_number).toBe(42);
      expect((result.team as { display_name: string }).display_name).toBe(
        '42 Robots',
      );
    }
  });

  it('returns 409 on duplicate team_number for the same event', async () => {
    const event = await seedEvent(testDb.db);
    await seedTeam(testDb.db, { event_id: event.id, team_number: 1 });

    const result = await createTeam({
      db: testDb.db,
      body: { event_id: event.id, team_number: 1, team_name: 'Dup' },
      userId: null,
      ipAddress: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
    }
  });

  it('returns 400 when event does not exist', async () => {
    const result = await createTeam({
      db: testDb.db,
      body: { event_id: 9999, team_number: 1, team_name: 'Ghost' },
      userId: null,
      ipAddress: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe('Event does not exist');
    }
  });
});
