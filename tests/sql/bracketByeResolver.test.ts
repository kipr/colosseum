/**
 * Bracket bye resolver tests - verify bye chain resolution works correctly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from './helpers/testDb';
import { resolveBracketByes } from '../../src/server/services/bracketByeResolver';

describe('Bracket Bye Resolver', () => {
  let testDb: TestDb;
  let eventId: number;
  let bracketId: number;

  beforeEach(async () => {
    testDb = await createTestDb();

    // Create an event and bracket
    const eventResult = await testDb.db.run(
      `INSERT INTO events (name, status) VALUES (?, ?)`,
      ['Test Event', 'setup'],
    );
    eventId = eventResult.lastID!;

    const bracketResult = await testDb.db.run(
      `INSERT INTO brackets (event_id, name, bracket_size) VALUES (?, ?, ?)`,
      [eventId, 'Test Bracket', 4],
    );
    bracketId = bracketResult.lastID!;
  });

  afterEach(() => {
    testDb.close();
  });

  /**
   * Helper to create teams for testing
   */
  async function createTeam(teamNumber: number): Promise<number> {
    const result = await testDb.db.run(
      `INSERT INTO teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
      [eventId, teamNumber, `Team ${teamNumber}`],
    );
    return result.lastID!;
  }

  /**
   * Helper to create bracket entries
   */
  async function createEntry(
    seedPosition: number,
    teamId: number | null,
    isBye: boolean,
  ): Promise<void> {
    await testDb.db.run(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye)
       VALUES (?, ?, ?, ?)`,
      [bracketId, teamId, seedPosition, isBye ? 1 : 0],
    );
  }

  /**
   * Helper to create a game
   */
  async function createGame(
    gameNumber: number,
    options: {
      team1Source?: string;
      team2Source?: string;
      team1Id?: number | null;
      team2Id?: number | null;
      status?: string;
      winnerAdvancesToId?: number | null;
      loserAdvancesToId?: number | null;
      winnerSlot?: string | null;
      loserSlot?: string | null;
    } = {},
  ): Promise<number> {
    const result = await testDb.db.run(
      `INSERT INTO bracket_games (
        bracket_id, game_number, team1_source, team2_source,
        team1_id, team2_id, status,
        winner_advances_to_id, loser_advances_to_id,
        winner_slot, loser_slot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bracketId,
        gameNumber,
        options.team1Source ?? null,
        options.team2Source ?? null,
        options.team1Id ?? null,
        options.team2Id ?? null,
        options.status ?? 'pending',
        options.winnerAdvancesToId ?? null,
        options.loserAdvancesToId ?? null,
        options.winnerSlot ?? null,
        options.loserSlot ?? null,
      ],
    );
    return result.lastID!;
  }

  describe('resolveSource from seeds', () => {
    it('should fill team slots from seed entries', async () => {
      // Create teams
      const team1Id = await createTeam(100);
      const team2Id = await createTeam(200);

      // Create entries
      await createEntry(1, team1Id, false);
      await createEntry(2, team2Id, false);

      // Create a game with seed sources but no team IDs yet
      const gameId = await createGame(1, {
        team1Source: 'seed:1',
        team2Source: 'seed:2',
      });

      // Run resolver
      const result = await resolveBracketByes(testDb.db, bracketId);

      // Check that slots were filled
      const game = await testDb.db.get(
        `SELECT * FROM bracket_games WHERE id = ?`,
        [gameId],
      );
      expect(game.team1_id).toBe(team1Id);
      expect(game.team2_id).toBe(team2Id);
      expect(result.slotsFilled).toBe(2);
    });

    it('should mark game as ready when both teams are filled', async () => {
      const team1Id = await createTeam(100);
      const team2Id = await createTeam(200);

      await createEntry(1, team1Id, false);
      await createEntry(2, team2Id, false);

      await createGame(1, {
        team1Source: 'seed:1',
        team2Source: 'seed:2',
        status: 'pending',
      });

      const result = await resolveBracketByes(testDb.db, bracketId);

      const game = await testDb.db.get(
        `SELECT * FROM bracket_games WHERE bracket_id = ?`,
        [bracketId],
      );
      expect(game.status).toBe('ready');
      expect(result.readyGamesUpdated).toBe(1);
    });
  });

  describe('implicit bye detection', () => {
    it('should detect implicit bye when one seed is missing', async () => {
      const team1Id = await createTeam(100);

      // Only seed 1 has a team, seed 2 is a bye
      await createEntry(1, team1Id, false);
      await createEntry(2, null, true);

      const gameId = await createGame(1, {
        team1Source: 'seed:1',
        team2Source: 'seed:2',
        status: 'pending',
      });

      const result = await resolveBracketByes(testDb.db, bracketId);

      const game = await testDb.db.get(
        `SELECT * FROM bracket_games WHERE id = ?`,
        [gameId],
      );

      // Team 1 should win by bye
      expect(game.status).toBe('bye');
      expect(game.winner_id).toBe(team1Id);
      expect(result.byeGamesResolved).toBe(1);
    });

    it('should propagate bye winner to next game', async () => {
      const team1Id = await createTeam(100);

      await createEntry(1, team1Id, false);
      await createEntry(2, null, true);

      // Create game 1 (will be a bye) that advances winner to game 2
      const game2Id = await createGame(2, {
        team1Source: 'winner:1',
        team2Source: 'seed:3', // Another source
        status: 'pending',
      });

      await createGame(1, {
        team1Source: 'seed:1',
        team2Source: 'seed:2',
        status: 'pending',
        winnerAdvancesToId: game2Id,
        winnerSlot: 'team1',
      });

      await resolveBracketByes(testDb.db, bracketId);

      const game2 = await testDb.db.get(
        `SELECT * FROM bracket_games WHERE id = ?`,
        [game2Id],
      );

      // Team 1 should be propagated to game 2's team1 slot
      expect(game2.team1_id).toBe(team1Id);
    });
  });

  describe('winner/loser source resolution', () => {
    it('should resolve winner source from completed game', async () => {
      const team1Id = await createTeam(100);
      const team2Id = await createTeam(200);

      await createEntry(1, team1Id, false);
      await createEntry(2, team2Id, false);

      // Create game 2 that takes winner from game 1
      const game2Id = await createGame(2, {
        team1Source: 'winner:1',
        team2Source: 'seed:3',
        status: 'pending',
      });

      // Create game 1 as already completed with a winner
      await createGame(1, {
        team1Source: 'seed:1',
        team2Source: 'seed:2',
        team1Id: team1Id,
        team2Id: team2Id,
        status: 'completed',
        winnerAdvancesToId: game2Id,
        winnerSlot: 'team1',
      });

      // Manually set winner for game 1
      await testDb.db.run(
        `UPDATE bracket_games SET winner_id = ? WHERE game_number = 1`,
        [team1Id],
      );

      await resolveBracketByes(testDb.db, bracketId);

      const game2 = await testDb.db.get(
        `SELECT * FROM bracket_games WHERE id = ?`,
        [game2Id],
      );

      expect(game2.team1_id).toBe(team1Id);
    });

    it('should resolve loser source from completed game', async () => {
      const team1Id = await createTeam(100);
      const team2Id = await createTeam(200);

      await createEntry(1, team1Id, false);
      await createEntry(2, team2Id, false);

      // Create game 2 (losers bracket) that takes loser from game 1
      const game2Id = await createGame(2, {
        team1Source: 'loser:1',
        status: 'pending',
      });

      // Create game 1 as completed
      await createGame(1, {
        team1Source: 'seed:1',
        team2Source: 'seed:2',
        team1Id: team1Id,
        team2Id: team2Id,
        status: 'completed',
        loserAdvancesToId: game2Id,
        loserSlot: 'team1',
      });

      // Set winner (team1 wins, so team2 is the loser)
      await testDb.db.run(
        `UPDATE bracket_games SET winner_id = ?, loser_id = ? WHERE game_number = 1`,
        [team1Id, team2Id],
      );

      await resolveBracketByes(testDb.db, bracketId);

      const game2 = await testDb.db.get(
        `SELECT * FROM bracket_games WHERE id = ?`,
        [game2Id],
      );

      expect(game2.team1_id).toBe(team2Id);
    });
  });

  describe('bye chain resolution', () => {
    it('should resolve multiple bye games in sequence', async () => {
      const team1Id = await createTeam(100);

      // 4-team bracket but only 1 team: seeds 2, 3, 4 are byes
      await createEntry(1, team1Id, false);
      await createEntry(2, null, true);
      await createEntry(3, null, true);
      await createEntry(4, null, true);

      // Create a simple bracket structure:
      // Game 1: seed 1 vs seed 4 -> winner to game 3
      // Game 2: seed 2 vs seed 3 -> winner to game 3
      // Game 3: winner of G1 vs winner of G2

      const game3Id = await createGame(3, {
        team1Source: 'winner:1',
        team2Source: 'winner:2',
        status: 'pending',
      });

      await createGame(1, {
        team1Source: 'seed:1',
        team2Source: 'seed:4',
        status: 'pending',
        winnerAdvancesToId: game3Id,
        winnerSlot: 'team1',
      });

      await createGame(2, {
        team1Source: 'seed:2',
        team2Source: 'seed:3',
        status: 'pending',
        winnerAdvancesToId: game3Id,
        winnerSlot: 'team2',
      });

      const result = await resolveBracketByes(testDb.db, bracketId);

      // Game 1: team1 wins by bye (seed 4 is bye)
      const game1 = await testDb.db.get(
        `SELECT * FROM bracket_games WHERE game_number = 1`,
      );
      expect(game1.status).toBe('bye');
      expect(game1.winner_id).toBe(team1Id);

      // Game 2: both teams are byes - should be marked bye with no winner
      const game2 = await testDb.db.get(
        `SELECT * FROM bracket_games WHERE game_number = 2`,
      );
      expect(game2.status).toBe('bye');

      // Game 3: should have team1 from G1's winner, team2 from G2 (which might be null)
      const game3 = await testDb.db.get(
        `SELECT * FROM bracket_games WHERE game_number = 3`,
      );
      expect(game3.team1_id).toBe(team1Id);

      // Multiple bye games should have been resolved
      expect(result.byeGamesResolved).toBeGreaterThanOrEqual(2);
    });

    it('should terminate when no more changes can be made', async () => {
      const team1Id = await createTeam(100);
      const team2Id = await createTeam(200);

      await createEntry(1, team1Id, false);
      await createEntry(2, team2Id, false);

      // Create a game that's already fully populated
      await createGame(1, {
        team1Source: 'seed:1',
        team2Source: 'seed:2',
        team1Id: team1Id,
        team2Id: team2Id,
        status: 'ready',
      });

      // Should complete quickly without infinite loop
      const result = await resolveBracketByes(testDb.db, bracketId);

      // Nothing should change
      expect(result.slotsFilled).toBe(0);
      expect(result.byeGamesResolved).toBe(0);
      expect(result.readyGamesUpdated).toBe(0);
    });
  });

  describe('championship reset (winners bracket wins grand final)', () => {
    it('should drop loser and give winner bye when winners bracket wins grand final', async () => {
      const winnersTeamId = await createTeam(100);
      const losersTeamId = await createTeam(200);

      // Grand final (game 6): team1 = winners bracket, team2 = losers bracket
      // Championship reset (game 7): winner:6 vs loser:6
      const resetGameId = await createGame(7, {
        team1Source: 'winner:6',
        team2Source: 'loser:6',
        status: 'pending',
      });

      await createGame(6, {
        team1Source: 'winner:3', // winners bracket
        team2Source: 'winner:5', // losers bracket
        team1Id: winnersTeamId,
        team2Id: losersTeamId,
        status: 'completed',
        winnerAdvancesToId: resetGameId,
        loserAdvancesToId: resetGameId,
        winnerSlot: 'team1',
        loserSlot: 'team2',
      });

      // Winners bracket (team1) wins grand final
      await testDb.db.run(
        `UPDATE bracket_games SET winner_id = ?, loser_id = ? WHERE game_number = 6`,
        [winnersTeamId, losersTeamId],
      );

      // Winner propagates to team1 of reset (via scoreAccept). Simulate that:
      await testDb.db.run(
        `UPDATE bracket_games SET team1_id = ? WHERE game_number = 7`,
        [winnersTeamId],
      );

      const result = await resolveBracketByes(testDb.db, bracketId);

      const resetGame = await testDb.db.get(
        `SELECT * FROM bracket_games WHERE id = ?`,
        [resetGameId],
      );

      // Championship reset should be a bye with winners bracket team as champion
      expect(resetGame.status).toBe('bye');
      expect(resetGame.winner_id).toBe(winnersTeamId);
      expect(result.byeGamesResolved).toBe(1);
    });

    it('should fill both slots when losers bracket wins grand final (normal reset)', async () => {
      const winnersTeamId = await createTeam(100);
      const losersTeamId = await createTeam(200);

      const resetGameId = await createGame(7, {
        team1Source: 'winner:6',
        team2Source: 'loser:6',
        status: 'pending',
      });

      await createGame(6, {
        team1Source: 'winner:3',
        team2Source: 'winner:5',
        team1Id: winnersTeamId,
        team2Id: losersTeamId,
        status: 'completed',
        winnerAdvancesToId: resetGameId,
        loserAdvancesToId: resetGameId,
        winnerSlot: 'team1',
        loserSlot: 'team2',
      });

      // Losers bracket (team2) wins grand final
      await testDb.db.run(
        `UPDATE bracket_games SET winner_id = ?, loser_id = ? WHERE game_number = 6`,
        [losersTeamId, winnersTeamId],
      );

      const result = await resolveBracketByes(testDb.db, bracketId);

      const resetGame = await testDb.db.get(
        `SELECT * FROM bracket_games WHERE id = ?`,
        [resetGameId],
      );

      // Both teams should be filled - normal championship reset
      expect(resetGame.team1_id).toBe(losersTeamId);
      expect(resetGame.team2_id).toBe(winnersTeamId);
      expect(result.slotsFilled).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('should handle empty bracket', async () => {
      // No games, no entries
      const result = await resolveBracketByes(testDb.db, bracketId);

      expect(result.slotsFilled).toBe(0);
      expect(result.byeGamesResolved).toBe(0);
      expect(result.readyGamesUpdated).toBe(0);
    });

    it('should skip already completed games', async () => {
      const team1Id = await createTeam(100);
      const team2Id = await createTeam(200);

      await createEntry(1, team1Id, false);
      await createEntry(2, team2Id, false);

      await createGame(1, {
        team1Source: 'seed:1',
        team2Source: 'seed:2',
        team1Id: team1Id,
        team2Id: team2Id,
        status: 'completed',
      });

      const result = await resolveBracketByes(testDb.db, bracketId);

      // Completed games should be skipped
      expect(result.slotsFilled).toBe(0);
      expect(result.readyGamesUpdated).toBe(0);
    });

    it('should skip already bye-resolved games', async () => {
      const team1Id = await createTeam(100);

      await createEntry(1, team1Id, false);
      await createEntry(2, null, true);

      await createGame(1, {
        team1Source: 'seed:1',
        team2Source: 'seed:2',
        team1Id: team1Id,
        status: 'bye', // Already marked as bye
      });

      const result = await resolveBracketByes(testDb.db, bracketId);

      // Already-bye games should be skipped
      expect(result.byeGamesResolved).toBe(0);
    });
  });
});
