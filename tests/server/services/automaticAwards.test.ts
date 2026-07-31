/**
 * Unit tests for configurable automatic award calculation.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import {
  computeAutomaticAwards,
  validateAutomaticAwardSettings,
} from '../../../src/server/services/automaticAwards';

describe('computeAutomaticAwards', () => {
  let testDb: TestDb;
  let eventId: number;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    const event = await testDb.db.run(
      `INSERT INTO events (name, status) VALUES (?, ?)`,
      ['Auto Awards', 'active'],
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

  it('omits categories configured as 0', async () => {
    const t1 = await createTeam(1);
    await testDb.db.run(
      `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank, raw_seed_score) VALUES (?, 80, 1, 10)`,
      [t1],
    );
    const bracket = await testDb.db.run(
      `INSERT INTO brackets (event_id, name, bracket_size, status, weight) VALUES (?, ?, ?, ?, ?)`,
      [eventId, 'Main', 4, 'completed', 1],
    );
    await testDb.db.run(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye, final_rank)
       VALUES (?, ?, 1, 0, 1)`,
      [bracket.lastID, t1],
    );

    const auto = await computeAutomaticAwards(eventId, {
      de_top_n: 0,
      per_bracket_overall_top_n: 0,
      seeding_top_n: 0,
    });
    expect(auto.de).toEqual([]);
    expect(auto.perBracketOverall).toEqual([]);
    expect(auto.seeding).toBeNull();
  });

  it('includes per-bracket overall for multi-bracket fully ranked events', async () => {
    const t1 = await createTeam(1);
    const t2 = await createTeam(2);
    await testDb.db.run(
      `INSERT INTO documentation_scores (event_id, team_id, overall_score) VALUES (?, ?, ?)`,
      [eventId, t1, 3],
    );
    await testDb.db.run(
      `INSERT INTO documentation_scores (event_id, team_id, overall_score) VALUES (?, ?, ?)`,
      [eventId, t2, 1],
    );
    await testDb.db.run(
      `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank, raw_seed_score) VALUES (?, 80, 1, 10)`,
      [t1],
    );
    await testDb.db.run(
      `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank, raw_seed_score) VALUES (?, 70, 2, 5)`,
      [t2],
    );

    const b1 = await testDb.db.run(
      `INSERT INTO brackets (event_id, name, bracket_size, status, weight) VALUES (?, ?, ?, ?, ?)`,
      [eventId, 'A', 2, 'completed', 1],
    );
    const b2 = await testDb.db.run(
      `INSERT INTO brackets (event_id, name, bracket_size, status, weight) VALUES (?, ?, ?, ?, ?)`,
      [eventId, 'B', 2, 'completed', 0.5],
    );
    await testDb.db.run(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye, final_rank, weighted_bracket_raw_score)
       VALUES (?, ?, 1, 0, 1, 1)`,
      [b1.lastID, t1],
    );
    await testDb.db.run(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye, final_rank, weighted_bracket_raw_score)
       VALUES (?, ?, 1, 0, 1, 0.5)`,
      [b2.lastID, t2],
    );

    const auto = await computeAutomaticAwards(eventId, {
      de_top_n: 1,
      per_bracket_overall_top_n: 1,
      seeding_top_n: 1,
    });
    expect(auto.perBracketOverall).toHaveLength(2);
    expect(auto.seeding?.placements[0].recipients[0].team_number).toBe(1);
    expect(auto.de).toHaveLength(2);
  });

  it('groups equal totals into the same place for overall awards', async () => {
    const t1 = await createTeam(1);
    const t2 = await createTeam(2);
    const t3 = await createTeam(3);
    for (const [id, doc] of [
      [t1, 5],
      [t2, 5],
      [t3, 1],
    ] as const) {
      await testDb.db.run(
        `INSERT INTO documentation_scores (event_id, team_id, overall_score) VALUES (?, ?, ?)`,
        [eventId, id, doc],
      );
    }

    const b1 = await testDb.db.run(
      `INSERT INTO brackets (event_id, name, bracket_size, status, weight) VALUES (?, ?, ?, ?, ?)`,
      [eventId, 'A', 4, 'completed', 1],
    );
    const b2 = await testDb.db.run(
      `INSERT INTO brackets (event_id, name, bracket_size, status, weight) VALUES (?, ?, ?, ?, ?)`,
      [eventId, 'B', 4, 'completed', 0.5],
    );
    await testDb.db.run(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye, final_rank, weighted_bracket_raw_score)
       VALUES (?, ?, 1, 0, 1, 1)`,
      [b1.lastID, t1],
    );
    await testDb.db.run(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye, final_rank, weighted_bracket_raw_score)
       VALUES (?, ?, 2, 0, 2, 1)`,
      [b1.lastID, t2],
    );
    await testDb.db.run(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye, final_rank, weighted_bracket_raw_score)
       VALUES (?, ?, 1, 0, 1, 0)`,
      [b2.lastID, t3],
    );

    const auto = await computeAutomaticAwards(eventId, {
      de_top_n: 0,
      per_bracket_overall_top_n: 2,
      seeding_top_n: 0,
    });
    const bracketA = auto.perBracketOverall.find((b) => b.bracket_name === 'A');
    expect(bracketA).toBeTruthy();
    expect(bracketA!.placements[0].recipients).toHaveLength(2);
  });
});

describe('validateAutomaticAwardSettings', () => {
  it('accepts 0 through team count', () => {
    expect(
      validateAutomaticAwardSettings(
        { de_top_n: 0, per_bracket_overall_top_n: 2, seeding_top_n: 5 },
        5,
      ),
    ).toBeNull();
  });

  it('rejects values above team count', () => {
    expect(
      validateAutomaticAwardSettings(
        { de_top_n: 6, per_bracket_overall_top_n: 0, seeding_top_n: 0 },
        5,
      ),
    ).toMatch(/de_top_n/);
  });
});
