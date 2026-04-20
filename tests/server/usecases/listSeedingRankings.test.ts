import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { listSeedingRankings } from '../../../src/server/usecases/listSeedingRankings';
import { seedEvent, seedTeam } from '../../http/helpers/seed';

describe('listSeedingRankings', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns empty list when no rankings exist', async () => {
    const event = await seedEvent(testDb.db);
    const result = await listSeedingRankings({
      db: testDb.db,
      eventId: event.id,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rankings).toEqual([]);
  });

  it('joins team metadata and orders by seed_rank', async () => {
    const event = await seedEvent(testDb.db);
    const t1 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    const t2 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 2,
    });

    await testDb.db.run(
      `INSERT INTO seeding_rankings (team_id, seed_rank, seed_average) VALUES (?, ?, ?)`,
      [t1.id, 2, 50],
    );
    await testDb.db.run(
      `INSERT INTO seeding_rankings (team_id, seed_rank, seed_average) VALUES (?, ?, ?)`,
      [t2.id, 1, 75],
    );

    const result = await listSeedingRankings({
      db: testDb.db,
      eventId: event.id,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rankings.length).toBe(2);
      expect((result.rankings[0] as { seed_rank: number }).seed_rank).toBe(1);
      expect((result.rankings[0] as { team_number: number }).team_number).toBe(
        2,
      );
    }
  });

  it('returns 404 for archived events', async () => {
    const event = await seedEvent(testDb.db, { status: 'archived' });
    const result = await listSeedingRankings({
      db: testDb.db,
      eventId: event.id,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});
