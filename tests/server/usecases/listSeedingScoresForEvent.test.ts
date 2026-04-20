import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { listSeedingScoresForEvent } from '../../../src/server/usecases/listSeedingScoresForEvent';
import { seedEvent, seedTeam, seedSeedingScore } from '../../http/helpers/seed';

describe('listSeedingScoresForEvent', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns scores joined with team metadata', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 7,
      team_name: 'Lions',
    });
    await seedSeedingScore(testDb.db, {
      team_id: team.id,
      round_number: 1,
      score: 100,
    });

    const result = await listSeedingScoresForEvent({
      db: testDb.db,
      eventId: event.id,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scores.length).toBe(1);
      expect((result.scores[0] as { team_number: number }).team_number).toBe(7);
      expect((result.scores[0] as { team_name: string }).team_name).toBe(
        'Lions',
      );
    }
  });

  it('returns 404 for archived events', async () => {
    const event = await seedEvent(testDb.db, { status: 'archived' });
    const result = await listSeedingScoresForEvent({
      db: testDb.db,
      eventId: event.id,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});
