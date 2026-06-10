/**
 * Overall scores must include the raw double-seeding contribution as a
 * separate field: documentation + raw seeding + raw double seeding + weighted DE.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { computeOverallScores } from '../../../src/server/services/overallScores';
import {
  seedEvent,
  seedTeam,
  seedDocumentationScore,
} from '../../http/helpers/seed';

describe('computeOverallScores - double seeding', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('adds raw_double_seed_score as a separate component of the total', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });

    await seedDocumentationScore(testDb.db, {
      event_id: event.id,
      team_id: team.id,
      overall_score: 2.5,
    });
    await testDb.db.run(
      `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank, raw_seed_score) VALUES (?, ?, ?, ?)`,
      [team.id, 100, 1, 0.75],
    );
    await testDb.db.run(
      `INSERT INTO double_seeding_rankings (team_id, seed_average, seed_rank, raw_double_seed_score) VALUES (?, ?, ?, ?)`,
      [team.id, 80, 1, 0.9],
    );

    const rows = await computeOverallScores(event.id);
    expect(rows.length).toBe(1);
    expect(rows[0].doc_score).toBeCloseTo(2.5);
    expect(rows[0].raw_seed_score).toBeCloseTo(0.75);
    expect(rows[0].raw_double_seed_score).toBeCloseTo(0.9);
    expect(rows[0].weighted_de_score).toBe(0);
    expect(rows[0].total).toBeCloseTo(2.5 + 0.75 + 0.9);
  });

  it('defaults the double-seeding contribution to zero when absent', async () => {
    const event = await seedEvent(testDb.db);
    await seedTeam(testDb.db, { event_id: event.id, team_number: 1 });

    const rows = await computeOverallScores(event.id);
    expect(rows.length).toBe(1);
    expect(rows[0].raw_double_seed_score).toBe(0);
    expect(rows[0].total).toBe(0);
  });
});
