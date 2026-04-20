import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { recalculateSeedingRankings } from '../../../src/server/usecases/recalculateSeedingRankings';
import { seedEvent, seedTeam, seedSeedingScore } from '../../http/helpers/seed';

describe('recalculateSeedingRankings', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns 404 when the event has no teams', async () => {
    const event = await seedEvent(testDb.db);
    const result = await recalculateSeedingRankings({
      db: testDb.db,
      eventId: event.id,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });

  it('returns rankings and counts when teams exist', async () => {
    const event = await seedEvent(testDb.db);
    const t1 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    const t2 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 2,
    });
    await seedSeedingScore(testDb.db, {
      team_id: t1.id,
      round_number: 1,
      score: 100,
    });
    await seedSeedingScore(testDb.db, {
      team_id: t2.id,
      round_number: 1,
      score: 50,
    });

    const result = await recalculateSeedingRankings({
      db: testDb.db,
      eventId: event.id,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.teamsRanked + result.teamsUnranked).toBe(2);
      expect(result.rankings.length).toBeGreaterThan(0);
    }
  });
});
