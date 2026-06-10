/**
 * Tests for double-seeding match generation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import {
  appendDoubleSeedingRounds,
  buildDoubleSeedingPairings,
  deleteLastDoubleSeedingRound,
  generateDoubleSeedingMatches,
  hasDoubleSeedingResults,
} from '../../../src/server/services/doubleSeedingMatches';
import {
  seedEvent,
  seedTeam,
  seedScoresheetTemplate,
  seedScoreSubmission,
  seedDoubleSeedingMatch,
  seedDoubleSeedingScore,
} from '../../http/helpers/seed';

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

describe('buildDoubleSeedingPairings', () => {
  it('creates the requested number of rounds with every team once per round (even team count)', () => {
    const teamIds = [1, 2, 3, 4, 5, 6, 7, 8];
    const rounds = 5;
    const pairs = buildDoubleSeedingPairings(teamIds, rounds);

    for (let round = 1; round <= rounds; round++) {
      const roundPairs = pairs.filter((p) => p.round === round);
      expect(roundPairs.length).toBe(4);

      const seen = new Set<number>();
      for (const pair of roundPairs) {
        expect(pair.team2Id).not.toBeNull();
        for (const teamId of [pair.team1Id, pair.team2Id!]) {
          expect(seen.has(teamId)).toBe(false);
          seen.add(teamId);
        }
      }
      expect(seen.size).toBe(teamIds.length);
    }
  });

  it('does not repeat pairings across rounds when capacity allows', () => {
    const teamIds = [1, 2, 3, 4, 5, 6, 7, 8];
    const pairs = buildDoubleSeedingPairings(teamIds, 5);

    const seenPairings = new Set<string>();
    for (const pair of pairs) {
      if (pair.team2Id === null) continue;
      const key = pairKey(pair.team1Id, pair.team2Id);
      expect(seenPairings.has(key)).toBe(false);
      seenPairings.add(key);
    }
  });

  it('creates one lone-run match per round with a rotating lone team (odd team count)', () => {
    const teamIds = [1, 2, 3, 4, 5, 6, 7];
    const rounds = 5;
    const pairs = buildDoubleSeedingPairings(teamIds, rounds);

    const loneTeams: number[] = [];
    for (let round = 1; round <= rounds; round++) {
      const roundPairs = pairs.filter((p) => p.round === round);
      const solo = roundPairs.filter((p) => p.team2Id === null);
      expect(solo.length).toBe(1);
      loneTeams.push(solo[0].team1Id);

      // Every team appears exactly once per round
      const seen = new Set<number>();
      for (const pair of roundPairs) {
        seen.add(pair.team1Id);
        if (pair.team2Id !== null) seen.add(pair.team2Id);
      }
      expect(seen.size).toBe(teamIds.length);
    }

    // The lone team should be different each round
    expect(new Set(loneTeams).size).toBe(rounds);
  });

  it('fails when the number of rounds exceeds the number of teams', () => {
    expect(() => buildDoubleSeedingPairings([1, 2, 3], 4)).toThrow(
      /cannot exceed/,
    );
  });

  it('fails when there are no teams', () => {
    expect(() => buildDoubleSeedingPairings([], 5)).toThrow(/No teams/);
  });
});

describe('generateDoubleSeedingMatches', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('persists ready matches and records the round count on the event', async () => {
    const event = await seedEvent(testDb.db);
    for (let i = 1; i <= 6; i++) {
      await seedTeam(testDb.db, { event_id: event.id, team_number: i });
    }

    const result = await generateDoubleSeedingMatches(testDb.db, event.id, 5);
    expect(result.rounds).toBe(5);
    expect(result.matchesCreated).toBe(15); // 3 matches x 5 rounds

    const matches = await testDb.db.all(
      'SELECT * FROM double_seeding_matches WHERE event_id = ? ORDER BY round_number, match_number',
      [event.id],
    );
    expect(matches.length).toBe(15);
    expect(matches.every((m) => m.status === 'ready')).toBe(true);
    expect(matches.every((m) => m.team1_id != null)).toBe(true);

    const eventRow = await testDb.db.get(
      'SELECT double_seeding_rounds FROM events WHERE id = ?',
      [event.id],
    );
    expect(eventRow?.double_seeding_rounds).toBe(5);
  });

  it('replaces existing matches on regeneration', async () => {
    const event = await seedEvent(testDb.db);
    for (let i = 1; i <= 4; i++) {
      await seedTeam(testDb.db, { event_id: event.id, team_number: i });
    }

    await generateDoubleSeedingMatches(testDb.db, event.id, 3);
    await generateDoubleSeedingMatches(testDb.db, event.id, 2);

    const matches = await testDb.db.all(
      'SELECT * FROM double_seeding_matches WHERE event_id = ?',
      [event.id],
    );
    expect(matches.length).toBe(4); // 2 matches x 2 rounds
  });

  it('appends rounds without replacing existing matches', async () => {
    const event = await seedEvent(testDb.db);
    for (let i = 1; i <= 4; i++) {
      await seedTeam(testDb.db, { event_id: event.id, team_number: i });
    }

    await generateDoubleSeedingMatches(testDb.db, event.id, 2);
    const before = await testDb.db.all<{ id: number }>(
      'SELECT id FROM double_seeding_matches WHERE event_id = ? ORDER BY id',
      [event.id],
    );

    const result = await appendDoubleSeedingRounds(testDb.db, event.id, 4);
    expect(result.rounds).toBe(4);
    expect(result.matchesCreated).toBe(4); // 2 new matches x 2 new rounds

    const after = await testDb.db.all<{ id: number; round_number: number }>(
      'SELECT id, round_number FROM double_seeding_matches WHERE event_id = ? ORDER BY id',
      [event.id],
    );
    expect(after.slice(0, before.length).map((m) => m.id)).toEqual(
      before.map((m) => m.id),
    );
    expect(after.length).toBe(8);
    expect(after.filter((m) => m.round_number > 2).length).toBe(4);

    const eventRow = await testDb.db.get(
      'SELECT double_seeding_rounds FROM events WHERE id = ?',
      [event.id],
    );
    expect(eventRow?.double_seeding_rounds).toBe(4);
  });

  it('deletes only the highest unsubmitted round', async () => {
    const event = await seedEvent(testDb.db);
    for (let i = 1; i <= 4; i++) {
      await seedTeam(testDb.db, { event_id: event.id, team_number: i });
    }
    await generateDoubleSeedingMatches(testDb.db, event.id, 3);

    await expect(
      deleteLastDoubleSeedingRound(testDb.db, event.id, 2),
    ).rejects.toThrow(/highest-numbered/);

    const result = await deleteLastDoubleSeedingRound(testDb.db, event.id, 3);
    expect(result.round).toBe(3);
    expect(result.deleted).toBe(2);
    expect(result.remainingRounds).toBe(2);

    const remaining = await testDb.db.all(
      'SELECT * FROM double_seeding_matches WHERE event_id = ? AND round_number = 3',
      [event.id],
    );
    expect(remaining.length).toBe(0);

    const eventRow = await testDb.db.get(
      'SELECT double_seeding_rounds FROM events WHERE id = ?',
      [event.id],
    );
    expect(eventRow?.double_seeding_rounds).toBe(2);
  });

  it('blocks deleting a round with double-seeding results', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    await seedTeam(testDb.db, { event_id: event.id, team_number: 2 });
    await generateDoubleSeedingMatches(testDb.db, event.id, 2);
    const match = await testDb.db.get<{ id: number }>(
      'SELECT id FROM double_seeding_matches WHERE event_id = ? AND round_number = 2 LIMIT 1',
      [event.id],
    );
    await seedDoubleSeedingScore(testDb.db, {
      event_id: event.id,
      match_id: match!.id,
      team_id: team.id,
      round_number: 2,
      side: 'team1',
      score: 50,
    });

    await expect(
      deleteLastDoubleSeedingRound(testDb.db, event.id, 2),
    ).rejects.toThrow(/submissions or scores/);
  });
});

describe('hasDoubleSeedingResults', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('detects accepted double-seeding scores and submissions', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });

    expect(await hasDoubleSeedingResults(testDb.db, event.id)).toBe(false);

    const match = await seedDoubleSeedingMatch(testDb.db, {
      event_id: event.id,
      round_number: 1,
      team1_id: team.id,
    });
    expect(await hasDoubleSeedingResults(testDb.db, event.id)).toBe(false);

    const template = await seedScoresheetTemplate(testDb.db);
    await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: '{}',
      event_id: event.id,
      score_type: 'double_seeding',
      double_seeding_match_id: match.id,
    });
    expect(await hasDoubleSeedingResults(testDb.db, event.id)).toBe(true);

    await testDb.db.run('DELETE FROM score_submissions');
    expect(await hasDoubleSeedingResults(testDb.db, event.id)).toBe(false);

    await seedDoubleSeedingScore(testDb.db, {
      event_id: event.id,
      match_id: match.id,
      team_id: team.id,
      round_number: 1,
      side: 'team1',
      score: 50,
    });
    expect(await hasDoubleSeedingResults(testDb.db, event.id)).toBe(true);
  });
});
