/**
 * Unit tests for automatic-award score/bracket diagnostics.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { computeAutomaticAwardDiagnostics } from '../../../src/server/services/eventScoreDiagnostics';

describe('computeAutomaticAwardDiagnostics', () => {
  let testDb: TestDb;
  let eventId: number;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    const event = await testDb.db.run(
      `INSERT INTO events (name, status, double_seeding_rounds) VALUES (?, ?, ?)`,
      ['Diag Event', 'active', 0],
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

  async function createBracket(
    name: string,
    weight: number,
  ): Promise<number> {
    const result = await testDb.db.run(
      `INSERT INTO brackets (event_id, name, bracket_size, status, weight) VALUES (?, ?, ?, ?, ?)`,
      [eventId, name, 4, 'in_progress', weight],
    );
    return result.lastID!;
  }

  it('reports clean diagnostics when all active components are non-zero', async () => {
    const t1 = await createTeam(1);
    await testDb.db.run(
      `INSERT INTO documentation_scores (event_id, team_id, overall_score) VALUES (?, ?, ?)`,
      [eventId, t1, 1],
    );
    await testDb.db.run(
      `INSERT INTO seeding_rankings (team_id, raw_seed_score, seed_rank) VALUES (?, ?, ?)`,
      [t1, 0.5, 1],
    );
    const b = await createBracket('Only', 1);
    await testDb.db.run(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye, weighted_bracket_raw_score)
       VALUES (?, ?, 1, 0, ?)`,
      [b, t1, 0.8],
    );

    const diag = await computeAutomaticAwardDiagnostics(eventId);
    expect(diag.zeroScoreIssues).toEqual([]);
    expect(diag.duplicateBracketWeights).toEqual([]);
  });

  it('flags zero/missing documentation, seeding, and weighted DE', async () => {
    const t1 = await createTeam(1);
    const b = await createBracket('Main', 1);
    await testDb.db.run(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye, weighted_bracket_raw_score)
       VALUES (?, ?, 1, 0, NULL)`,
      [b, t1],
    );

    const diag = await computeAutomaticAwardDiagnostics(eventId);
    expect(diag.zeroScoreIssues).toHaveLength(1);
    expect(diag.zeroScoreIssues[0].components).toEqual(
      expect.arrayContaining(['documentation', 'seeding', 'weighted_de']),
    );
    expect(diag.zeroScoreIssues[0].components).not.toContain('double_seeding');
  });

  it('includes double seeding only when enabled', async () => {
    await testDb.db.run(
      `UPDATE events SET double_seeding_rounds = 2 WHERE id = ?`,
      [eventId],
    );
    const t1 = await createTeam(1);
    await testDb.db.run(
      `INSERT INTO documentation_scores (event_id, team_id, overall_score) VALUES (?, ?, ?)`,
      [eventId, t1, 1],
    );
    await testDb.db.run(
      `INSERT INTO seeding_rankings (team_id, raw_seed_score, seed_rank) VALUES (?, ?, ?)`,
      [t1, 0.5, 1],
    );

    const diag = await computeAutomaticAwardDiagnostics(eventId);
    expect(diag.zeroScoreIssues[0].components).toContain('double_seeding');
    expect(diag.zeroScoreIssues[0].components).not.toContain('weighted_de');
  });

  it('reports duplicate bracket weights only for multi-bracket events', async () => {
    await createBracket('A', 1);
    await createBracket('B', 1);
    await createBracket('C', 0.5);

    const diag = await computeAutomaticAwardDiagnostics(eventId);
    expect(diag.duplicateBracketWeights).toHaveLength(1);
    expect(diag.duplicateBracketWeights[0].weight).toBe(1);
    expect(diag.duplicateBracketWeights[0].brackets.map((b) => b.name)).toEqual(
      ['A', 'B'],
    );
  });

  it('does not report duplicate weights for a single bracket', async () => {
    await createBracket('Solo', 1);
    const diag = await computeAutomaticAwardDiagnostics(eventId);
    expect(diag.duplicateBracketWeights).toEqual([]);
  });

  it('does not report duplicate weights when multi-bracket weights differ', async () => {
    await createBracket('A', 1);
    await createBracket('B', 0.5);
    const diag = await computeAutomaticAwardDiagnostics(eventId);
    expect(diag.duplicateBracketWeights).toEqual([]);
  });
});
