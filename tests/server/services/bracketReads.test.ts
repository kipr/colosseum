/**
 * Unit tests for the shared bracket read queries.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import {
  listBracketGamesWithTeams,
  listBracketRankingEntries,
} from '../../../src/server/services/bracketReads';

describe('bracketReads', () => {
  let testDb: TestDb;
  let eventId: number;
  let bracketId: number;

  beforeEach(async () => {
    testDb = await createTestDb();
    const event = await testDb.db.run(
      `INSERT INTO events (name, status) VALUES (?, ?) RETURNING id`,
      ['Bracket Reads', 'active'],
    );
    eventId = event.lastID!;
    const bracket = await testDb.db.run(
      `INSERT INTO brackets (event_id, name, bracket_size, status, weight) VALUES (?, ?, ?, ?, ?) RETURNING id`,
      [eventId, 'Main', 4, 'in_progress', 0.5],
    );
    bracketId = bracket.lastID!;
  });

  afterEach(() => {
    testDb.close();
  });

  async function createTeam(teamNumber: number): Promise<number> {
    const result = await testDb.db.run(
      `INSERT INTO teams (event_id, team_number, team_name, display_name) VALUES (?, ?, ?, ?) RETURNING id`,
      [eventId, teamNumber, `Team ${teamNumber}`, `${teamNumber} Display`],
    );
    return result.lastID!;
  }

  describe('listBracketGamesWithTeams', () => {
    it('joins team1, team2 and winner fields ordered by game number', async () => {
      const t1 = await createTeam(1);
      const t2 = await createTeam(2);
      const t3 = await createTeam(3);
      await testDb.db.run(
        `INSERT INTO bracket_games (bracket_id, game_number, team1_id, team2_id, status) VALUES (?, 2, ?, NULL, 'pending') RETURNING id`,
        [bracketId, t3],
      );
      await testDb.db.run(
        `INSERT INTO bracket_games (bracket_id, game_number, team1_id, team2_id, winner_id, loser_id, status) VALUES (?, 1, ?, ?, ?, ?, 'completed') RETURNING id`,
        [bracketId, t1, t2, t2, t1],
      );

      const games = await listBracketGamesWithTeams(testDb.db, bracketId);

      expect(games.map((g) => g.game_number)).toEqual([1, 2]);
      expect(games[0]).toMatchObject({
        bracket_id: bracketId,
        status: 'completed',
        team1_id: t1,
        team1_number: 1,
        team1_name: 'Team 1',
        team1_display: '1 Display',
        team2_id: t2,
        team2_number: 2,
        team2_name: 'Team 2',
        team2_display: '2 Display',
        winner_id: t2,
        winner_number: 2,
        winner_name: 'Team 2',
        winner_display: '2 Display',
      });
      expect(games[1]).toMatchObject({
        team1_number: 3,
        team2_id: null,
        team2_number: null,
        team2_name: null,
        winner_id: null,
        winner_number: null,
      });
    });

    it('returns only games for the requested bracket', async () => {
      const other = await testDb.db.run(
        `INSERT INTO brackets (event_id, name, bracket_size) VALUES (?, ?, ?) RETURNING id`,
        [eventId, 'Other', 4],
      );
      await testDb.db.run(
        `INSERT INTO bracket_games (bracket_id, game_number) VALUES (?, 1) RETURNING id`,
        [other.lastID],
      );

      expect(await listBracketGamesWithTeams(testDb.db, bracketId)).toEqual(
        [],
      );
    });
  });

  describe('listBracketRankingEntries', () => {
    it('orders by final rank with unranked entries and byes last by seed', async () => {
      const t1 = await createTeam(1);
      const t2 = await createTeam(2);
      const t3 = await createTeam(3);
      await testDb.db.run(
        `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, initial_slot, is_bye, final_rank, bracket_raw_score, weighted_bracket_raw_score)
         VALUES (?, ?, 1, 1, FALSE, 2, 0.5, 0.25),
                (?, ?, 2, 4, FALSE, 1, 1.0, 0.5),
                (?, ?, 3, 3, FALSE, NULL, NULL, NULL),
                (?, NULL, 4, 2, TRUE, NULL, NULL, NULL)`,
        [bracketId, t1, bracketId, t2, bracketId, t3, bracketId],
      );
      await testDb.db.run(
        `INSERT INTO seeding_rankings (team_id, seed_rank, raw_seed_score) VALUES (?, 1, 0.75) RETURNING id`,
        [t2],
      );
      await testDb.db.run(
        `INSERT INTO documentation_scores (event_id, team_id, overall_score) VALUES (?, ?, 0.5) RETURNING id`,
        [eventId, t2],
      );

      const entries = await listBracketRankingEntries(
        testDb.db,
        eventId,
        bracketId,
      );

      expect(entries.map((e) => [e.seed_position, e.final_rank])).toEqual([
        [2, 1],
        [1, 2],
        [3, null],
        [4, null],
      ]);
      expect(entries[0]).toMatchObject({
        team_id: t2,
        initial_slot: 4,
        is_bye: false,
        bracket_raw_score: 1,
        weighted_bracket_raw_score: 0.5,
        doc_score: 0.5,
        raw_seed_score: 0.75,
        raw_double_seed_score: 0,
        total: 1.75,
        team_number: 2,
        team_name: 'Team 2',
        display_name: '2 Display',
      });
      expect(entries[3]).toMatchObject({
        team_id: null,
        is_bye: true,
        team_number: null,
        total: 0,
      });
    });
  });
});
