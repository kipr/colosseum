import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { getPublicOverallScores } from '../../../src/server/usecases/getPublicOverallScores';
import { seedEvent, seedTeam } from '../../http/helpers/seed';

describe('getPublicOverallScores', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns 404 when the event is not complete', async () => {
    const event = await seedEvent(testDb.db, { status: 'active' });
    const result = await getPublicOverallScores({ eventId: event.id });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });

  it('returns 404 when complete but spectator results not released', async () => {
    const event = await seedEvent(testDb.db, { status: 'complete' });
    const result = await getPublicOverallScores({ eventId: event.id });
    expect(result.ok).toBe(false);
  });

  it('returns rows when complete and spectator results released', async () => {
    const event = await seedEvent(testDb.db, { status: 'complete' });
    await seedTeam(testDb.db, { event_id: event.id, team_number: 1 });
    await testDb.db.run(
      'UPDATE events SET spectator_results_released = 1 WHERE id = ?',
      [event.id],
    );

    const result = await getPublicOverallScores({ eventId: event.id });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
    }
  });
});
