import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { listSeedingScoresForTeam } from '../../../src/server/usecases/listSeedingScoresForTeam';
import { seedEvent, seedTeam, seedSeedingScore } from '../../http/helpers/seed';

describe('listSeedingScoresForTeam', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns the team scores ordered by round_number', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    await seedSeedingScore(testDb.db, {
      team_id: team.id,
      round_number: 2,
      score: 50,
    });
    await seedSeedingScore(testDb.db, {
      team_id: team.id,
      round_number: 1,
      score: 25,
    });

    const result = await listSeedingScoresForTeam({
      db: testDb.db,
      teamId: team.id,
    });
    expect(result.scores.length).toBe(2);
    expect((result.scores[0] as { round_number: number }).round_number).toBe(1);
  });
});
