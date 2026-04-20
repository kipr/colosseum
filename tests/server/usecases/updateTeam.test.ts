import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { updateTeam } from '../../../src/server/usecases/updateTeam';
import { seedEvent, seedTeam } from '../../http/helpers/seed';

describe('updateTeam', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns 404 when the team does not exist', async () => {
    const result = await updateTeam({
      db: testDb.db,
      teamId: 9999,
      body: { team_name: 'New' },
      userId: null,
      ipAddress: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });

  it('returns 400 when no allowed fields are provided', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    const result = await updateTeam({
      db: testDb.db,
      teamId: team.id,
      body: { unknown_field: 'x' },
      userId: null,
      ipAddress: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('updates only allowed fields', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
      team_name: 'Old',
    });
    const result = await updateTeam({
      db: testDb.db,
      teamId: team.id,
      body: { team_name: 'New', not_allowed: 'ignored' },
      userId: null,
      ipAddress: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.team as { team_name: string }).team_name).toBe('New');
    }
  });

  it('returns 409 when renumbering to an existing team_number', async () => {
    const event = await seedEvent(testDb.db);
    await seedTeam(testDb.db, { event_id: event.id, team_number: 1 });
    const team2 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 2,
    });
    const result = await updateTeam({
      db: testDb.db,
      teamId: team2.id,
      body: { team_number: 1 },
      userId: null,
      ipAddress: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });
});
