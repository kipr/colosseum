import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { upsertSeedingScore } from '../../../src/server/usecases/upsertSeedingScore';
import { seedEvent, seedTeam } from '../../http/helpers/seed';

describe('upsertSeedingScore', () => {
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
    const result = await upsertSeedingScore({ db: testDb.db, body: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('inserts a new row when none exists', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    const result = await upsertSeedingScore({
      db: testDb.db,
      body: { team_id: team.id, round_number: 1, score: 50 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.score as { score: number }).score).toBe(50);
    }
  });

  it('replaces an existing score for the same (team, round)', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    await upsertSeedingScore({
      db: testDb.db,
      body: { team_id: team.id, round_number: 1, score: 50 },
    });

    const result = await upsertSeedingScore({
      db: testDb.db,
      body: { team_id: team.id, round_number: 1, score: 75 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.score as { score: number }).score).toBe(75);
    }
  });

  it('returns 400 when team does not exist (FK violation)', async () => {
    const result = await upsertSeedingScore({
      db: testDb.db,
      body: { team_id: 9999, round_number: 1, score: 10 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe('Team does not exist');
    }
  });
});
