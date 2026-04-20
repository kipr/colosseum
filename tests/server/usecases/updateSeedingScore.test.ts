import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { updateSeedingScore } from '../../../src/server/usecases/updateSeedingScore';
import { seedEvent, seedTeam, seedSeedingScore } from '../../http/helpers/seed';

describe('updateSeedingScore', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns 400 when no allowed fields are provided', async () => {
    const result = await updateSeedingScore({
      db: testDb.db,
      scoreId: 1,
      body: { unknown: 'x' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns 404 when the row does not exist', async () => {
    const result = await updateSeedingScore({
      db: testDb.db,
      scoreId: 9999,
      body: { score: 10 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });

  it('updates only allowed fields', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    const score = await seedSeedingScore(testDb.db, {
      team_id: team.id,
      round_number: 1,
      score: 10,
    });

    const result = await updateSeedingScore({
      db: testDb.db,
      scoreId: score.id,
      body: { score: 99, team_id: 999 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.score as { score: number }).score).toBe(99);
      expect((result.score as { team_id: number }).team_id).toBe(team.id);
    }
  });
});
