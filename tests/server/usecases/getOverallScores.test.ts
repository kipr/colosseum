import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { getOverallScores } from '../../../src/server/usecases/getOverallScores';
import {
  seedEvent,
  seedTeam,
  seedDocumentationScore,
  seedSeedingScore,
} from '../../http/helpers/seed';

describe('getOverallScores', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns 404 when the event does not exist', async () => {
    const result = await getOverallScores({ db: testDb.db, eventId: 9999 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });

  it('returns computed rows for a valid event', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    await seedDocumentationScore(testDb.db, {
      event_id: event.id,
      team_id: team.id,
      overall_score: 0.5,
    });
    await seedSeedingScore(testDb.db, {
      team_id: team.id,
      round_number: 1,
      score: 100,
    });
    await testDb.db.run(
      'INSERT INTO seeding_rankings (team_id, raw_seed_score) VALUES (?, ?)',
      [team.id, 0.8],
    );

    const result = await getOverallScores({ db: testDb.db, eventId: event.id });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].team_number).toBe(1);
      expect(result.rows[0].doc_score).toBe(0.5);
      expect(result.rows[0].raw_seed_score).toBe(0.8);
      expect(result.rows[0].total).toBeCloseTo(1.3, 4);
    }
  });
});
