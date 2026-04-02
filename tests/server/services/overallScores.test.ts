/**
 * Unit tests for computeOverallScores service.
 * Verifies the batched bracket query and correct aggregation across multiple brackets.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { computeOverallScores } from '../../../src/server/services/overallScores';

describe('computeOverallScores', () => {
  let testDb: TestDb;
  let eventId: number;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    const event = await testDb.db.run(
      `INSERT INTO events (name, status) VALUES (?, ?)`,
      ['Overall Test Event', 'active'],
    );
    eventId = event.lastID!;
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  async function createTeam(teamNumber: number): Promise<number> {
    const result = await testDb.db.run(
      `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
      [eventId, teamNumber, `Team ${teamNumber}`],
    );
    return result.lastID!;
  }

  async function createBracket(weight: number): Promise<number> {
    const result = await testDb.db.run(
      `INSERT INTO brackets (event_id, name, bracket_size, status, weight) VALUES (?, ?, ?, ?, ?)`,
      [eventId, 'Test Bracket', 4, 'in_progress', weight],
    );
    return result.lastID!;
  }

  it('returns empty array when event has no teams', async () => {
    const rows = await computeOverallScores(eventId);
    expect(rows).toEqual([]);
  });

  it('aggregates doc, seeding, and bracket scores from multiple brackets in single query', async () => {
    const t1 = await createTeam(1);
    const t2 = await createTeam(2);

    await testDb.db.run(
      `INSERT INTO documentation_scores (event_id, team_id, overall_score, scored_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [eventId, t1, 0.5],
    );
    await testDb.db.run(
      `INSERT INTO documentation_scores (event_id, team_id, overall_score, scored_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [eventId, t2, 0.3],
    );

    await testDb.db.run(
      `INSERT INTO seeding_rankings (team_id, raw_seed_score) VALUES (?, ?)`,
      [t1, 0.8],
    );
    await testDb.db.run(
      `INSERT INTO seeding_rankings (team_id, raw_seed_score) VALUES (?, ?)`,
      [t2, 0.6],
    );

    const b1 = await createBracket(1);
    const b2 = await createBracket(0.5);

    await testDb.db.run(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye, weighted_bracket_raw_score) VALUES (?, ?, ?, ?, ?)`,
      [b1, t1, 1, 0, 0.9],
    );
    await testDb.db.run(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye, weighted_bracket_raw_score) VALUES (?, ?, ?, ?, ?)`,
      [b2, t2, 1, 0, 0.4],
    );

    const rows = await computeOverallScores(eventId);

    expect(rows).toHaveLength(2);
    const r1 = rows.find((r) => r.team_id === t1)!;
    const r2 = rows.find((r) => r.team_id === t2)!;

    expect(r1.doc_score).toBe(0.5);
    expect(r1.raw_seed_score).toBe(0.8);
    expect(r1.weighted_de_score).toBe(0.9);
    expect(r1.total).toBeCloseTo(2.2, 4);

    expect(r2.doc_score).toBe(0.3);
    expect(r2.raw_seed_score).toBe(0.6);
    expect(r2.weighted_de_score).toBe(0.4);
    expect(r2.total).toBeCloseTo(1.3, 4);

    expect(rows[0].total).toBeGreaterThanOrEqual(rows[1].total);
  });

  it('sums weighted_bracket_raw_score when the same team appears in multiple brackets', async () => {
    const t1 = await createTeam(1);
    await testDb.db.run(
      `INSERT INTO documentation_scores (event_id, team_id, overall_score, scored_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [eventId, t1, 0.1],
    );
    await testDb.db.run(
      `INSERT INTO seeding_rankings (team_id, raw_seed_score) VALUES (?, ?)`,
      [t1, 0.2],
    );
    const b1 = await createBracket(1);
    const b2 = await createBracket(1);
    await testDb.db.run(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye, weighted_bracket_raw_score) VALUES (?, ?, ?, ?, ?)`,
      [b1, t1, 1, 0, 0.5],
    );
    await testDb.db.run(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye, weighted_bracket_raw_score) VALUES (?, ?, ?, ?, ?)`,
      [b2, t1, 1, 0, 0.3],
    );

    const rows = await computeOverallScores(eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0].weighted_de_score).toBeCloseTo(0.8, 4);
    expect(rows[0].total).toBeCloseTo(1.1, 4);
  });
});
