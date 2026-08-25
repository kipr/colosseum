/**
 * Bracket template seeding tests - verify templates are generated correctly
 * and that seeding is idempotent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, TestDb } from './helpers/testDb';
import { initializeSQLite } from '../../src/server/database/init';
import {
  ensureBracketTemplatesSeeded,
  generateDEBracketTemplates,
} from '../../src/server/services/bracketTemplates';

describe('Bracket Template Seeding', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  describe('ensureBracketTemplatesSeeded', () => {
    it('should seed templates for 4-team bracket', async () => {
      await ensureBracketTemplatesSeeded(testDb.db, 4);

      const templates = await testDb.db.all(
        `SELECT * FROM bracket_templates WHERE bracket_size = ? ORDER BY game_number`,
        [4],
      );

      expect(templates.length).toBeGreaterThan(0);
      // 4-team DE has 7 games (including reset)
      expect(templates).toHaveLength(7);
    });

    it('should seed templates for 8-team bracket', async () => {
      await ensureBracketTemplatesSeeded(testDb.db, 8);

      const templates = await testDb.db.all(
        `SELECT * FROM bracket_templates WHERE bracket_size = ? ORDER BY game_number`,
        [8],
      );

      // 8-team DE has 15 games
      expect(templates).toHaveLength(15);
    });

    it('should seed templates for 16-team bracket', async () => {
      await ensureBracketTemplatesSeeded(testDb.db, 16);

      const templates = await testDb.db.all(
        `SELECT * FROM bracket_templates WHERE bracket_size = ? ORDER BY game_number`,
        [16],
      );

      // 16-team DE has 31 games
      expect(templates).toHaveLength(31);
    });

    it('should seed templates for 32-team bracket', async () => {
      await ensureBracketTemplatesSeeded(testDb.db, 32);

      const templates = await testDb.db.all(
        `SELECT * FROM bracket_templates WHERE bracket_size = ? ORDER BY game_number`,
        [32],
      );

      // 32-team DE has 63 games
      expect(templates).toHaveLength(63);
    });

    it('should seed templates for 64-team bracket', async () => {
      await ensureBracketTemplatesSeeded(testDb.db, 64);

      const templates = await testDb.db.all(
        `SELECT * FROM bracket_templates WHERE bracket_size = ? ORDER BY game_number`,
        [64],
      );

      // 64-team DE has 127 games
      expect(templates).toHaveLength(127);
    });

    it('should be idempotent - calling twice produces same result', async () => {
      // First call
      await ensureBracketTemplatesSeeded(testDb.db, 8);
      const firstCount = await testDb.db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM bracket_templates WHERE bracket_size = ?`,
        [8],
      );

      // Second call
      await ensureBracketTemplatesSeeded(testDb.db, 8);
      const secondCount = await testDb.db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM bracket_templates WHERE bracket_size = ?`,
        [8],
      );

      expect(firstCount?.count).toBe(secondCount?.count);
      expect(secondCount?.count).toBe(15);
    });

    it('should seed different bracket sizes independently', async () => {
      await ensureBracketTemplatesSeeded(testDb.db, 4);
      await ensureBracketTemplatesSeeded(testDb.db, 8);

      const size4 = await testDb.db.all(
        `SELECT * FROM bracket_templates WHERE bracket_size = ?`,
        [4],
      );
      const size8 = await testDb.db.all(
        `SELECT * FROM bracket_templates WHERE bracket_size = ?`,
        [8],
      );

      expect(size4).toHaveLength(7);
      expect(size8).toHaveLength(15);
    });

    it('should seed a complete play_order permutation for every size', async () => {
      for (const size of [4, 8, 16, 32, 64]) {
        await ensureBracketTemplatesSeeded(testDb.db, size);
        const templates = await testDb.db.all<{ play_order: number | null }>(
          `SELECT play_order FROM bracket_templates
           WHERE bracket_size = ? ORDER BY play_order`,
          [size],
        );

        expect(templates.map((template) => template.play_order)).toEqual(
          Array.from({ length: 2 * size - 1 }, (_, index) => index + 1),
        );
      }
    });

    it('should repair play_order without overwriting hand-edited template fields', async () => {
      await ensureBracketTemplatesSeeded(testDb.db, 8);
      const expected = generateDEBracketTemplates(8).find(
        (template) => template.game_number === 5,
      )?.play_order;
      await testDb.db.run(
        `UPDATE bracket_templates
         SET play_order = NULL, round_name = 'Custom Winners Round'
         WHERE bracket_size = 8 AND game_number = 5`,
      );

      await ensureBracketTemplatesSeeded(testDb.db, 8);

      const repaired = await testDb.db.get<{
        play_order: number;
        round_name: string;
      }>(
        `SELECT play_order, round_name FROM bracket_templates
         WHERE bracket_size = 8 AND game_number = 5`,
      );
      expect(repaired?.play_order).toBe(expected);
      expect(repaired?.round_name).toBe('Custom Winners Round');
    });

    it('should backfill legacy bracket games during database initialization', async () => {
      const event = await testDb.db.run(
        `INSERT INTO events (name, status) VALUES ('Legacy Event', 'setup')`,
      );
      const bracket = await testDb.db.run(
        `INSERT INTO brackets (event_id, name, bracket_size)
         VALUES (?, 'Legacy Bracket', 8)`,
        [event.lastID],
      );
      const game1 = await testDb.db.run(
        `INSERT INTO bracket_games (bracket_id, game_number, play_order)
         VALUES (?, 1, NULL)`,
        [bracket.lastID],
      );
      await testDb.db.run(
        `INSERT INTO bracket_games (bracket_id, game_number, play_order)
         VALUES (?, 5, 77), (?, 99, NULL)`,
        [bracket.lastID, bracket.lastID],
      );
      await testDb.db.run(
        `INSERT INTO game_queue (
           event_id, queue_type, queue_position, bracket_game_id
         ) VALUES (?, 'bracket', 7, ?)`,
        [event.lastID, game1.lastID],
      );

      const unsupported = await testDb.db.run(
        `INSERT INTO brackets (event_id, name, bracket_size)
         VALUES (?, 'Custom Bracket', 10)`,
        [event.lastID],
      );
      await testDb.db.run(
        `INSERT INTO bracket_games (bracket_id, game_number, play_order)
         VALUES (?, 1, NULL)`,
        [unsupported.lastID],
      );
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        await initializeSQLite(testDb.db);
      } finally {
        warning.mockRestore();
      }

      const games = await testDb.db.all<{
        game_number: number;
        play_order: number | null;
      }>(
        `SELECT game_number, play_order FROM bracket_games
         WHERE bracket_id = ? ORDER BY game_number`,
        [bracket.lastID],
      );
      expect(games).toEqual([
        { game_number: 1, play_order: 1 },
        { game_number: 5, play_order: 77 },
        { game_number: 99, play_order: null },
      ]);
      const customGame = await testDb.db.get<{ play_order: number | null }>(
        `SELECT play_order FROM bracket_games WHERE bracket_id = ?`,
        [unsupported.lastID],
      );
      expect(customGame?.play_order).toBeNull();
      const queue = await testDb.db.get<{ queue_position: number }>(
        `SELECT queue_position FROM game_queue WHERE bracket_game_id = ?`,
        [game1.lastID],
      );
      expect(queue?.queue_position).toBe(7);
    });
  });

  describe('generateDEBracketTemplates', () => {
    it.each([
      [8, 5, 6, 9],
      [16, 9, 12, 17],
      [32, 17, 24, 33],
      [64, 33, 48, 65],
    ])(
      'should cross-bracket Winners R2 losers for a %i-team bracket',
      (size, winnersStart, winnersEnd, redemptionStart) => {
        const templates = generateDEBracketTemplates(size);
        const winnersGameCount = winnersEnd - winnersStart + 1;

        for (let position = 0; position < winnersGameCount; position++) {
          const winnersGame = templates.find(
            (template) => template.game_number === winnersStart + position,
          );
          const redemptionPosition =
            (position + winnersGameCount / 2) % winnersGameCount;
          const redemptionGame = templates.find(
            (template) =>
              template.game_number === redemptionStart + redemptionPosition,
          );

          expect(winnersGame?.loser_advances_to).toBe(
            redemptionGame?.game_number,
          );
          expect(redemptionGame?.team2_source).toBe(
            `loser:${winnersGame?.game_number}`,
          );
        }
      },
    );

    it.each([
      [32, 57, 58, 55],
      [64, 113, 116, 109],
    ])(
      'should cross-bracket later Winners losers for a %i-team bracket',
      (size, winnersStart, winnersEnd, redemptionStart) => {
        const templates = generateDEBracketTemplates(size);
        const winnersGameCount = winnersEnd - winnersStart + 1;

        for (let position = 0; position < winnersGameCount; position++) {
          const winnersGame = templates.find(
            (template) => template.game_number === winnersStart + position,
          );
          const redemptionPosition =
            (position + winnersGameCount / 2) % winnersGameCount;
          const redemptionGame = templates.find(
            (template) =>
              template.game_number === redemptionStart + redemptionPosition,
          );

          expect(winnersGame?.loser_advances_to).toBe(
            redemptionGame?.game_number,
          );
          expect(redemptionGame?.team2_source).toBe(
            `loser:${winnersGame?.game_number}`,
          );
        }
      },
    );

    it('should keep the two Game 50 paths separate until Game 59', () => {
      const templates = generateDEBracketTemplates(32);
      const game = (gameNumber: number) =>
        templates.find((template) => template.game_number === gameNumber);

      // The G50 loser can reach G55 through G46 and G53. If the G50 winner
      // later loses G57, it now enters the opposite branch at G56.
      expect(game(50)?.loser_advances_to).toBe(46);
      expect(game(46)?.winner_advances_to).toBe(53);
      expect(game(53)?.winner_advances_to).toBe(55);
      expect(game(57)?.loser_advances_to).toBe(56);
      expect(game(56)?.team2_source).toBe('loser:57');
      expect(game(55)?.winner_advances_to).toBe(59);
      expect(game(56)?.winner_advances_to).toBe(59);
    });

    it('should keep the two Game 97 paths separate until Game 123', () => {
      const templates = generateDEBracketTemplates(64);
      const game = (gameNumber: number) =>
        templates.find((template) => template.game_number === gameNumber);

      // The G97 loser can reach G109 through G89 and G105. If the G97 winner
      // later loses G113, it now enters the opposite half at G111.
      expect(game(97)?.loser_advances_to).toBe(89);
      expect(game(89)?.winner_advances_to).toBe(105);
      expect(game(105)?.winner_advances_to).toBe(109);
      expect(game(113)?.loser_advances_to).toBe(111);
      expect(game(111)?.team2_source).toBe('loser:113');
      expect(game(109)?.winner_advances_to).toBe(117);
      expect(game(117)?.winner_advances_to).toBe(119);
      expect(game(119)?.winner_advances_to).toBe(123);
      expect(game(111)?.winner_advances_to).toBe(118);
      expect(game(118)?.winner_advances_to).toBe(120);
      expect(game(120)?.winner_advances_to).toBe(123);
    });

    it('should prevent an immediate rematch in the 10-team bracket scenario', () => {
      const templates = generateDEBracketTemplates(16);
      const game = (gameNumber: number) =>
        templates.find((template) => template.game_number === gameNumber);

      // With 10 teams, G1 is a bye. The G2 loser therefore advances through
      // G13, while the G2 winner can lose G9. Those teams must not meet in G17.
      expect(game(13)?.team2_source).toBe('loser:2');
      expect(game(13)?.winner_advances_to).toBe(17);
      expect(game(9)?.loser_advances_to).toBe(19);
      expect(game(17)?.team2_source).toBe('loser:11');
      expect(game(19)?.team2_source).toBe('loser:9');

      // The two routes stay on opposite branches until Redemption Semi (G27).
      expect(game(17)?.winner_advances_to).toBe(21);
      expect(game(21)?.winner_advances_to).toBe(23);
      expect(game(23)?.winner_advances_to).toBe(27);
      expect(game(19)?.winner_advances_to).toBe(22);
      expect(game(22)?.winner_advances_to).toBe(24);
      expect(game(24)?.winner_advances_to).toBe(27);
    });

    it('should have unique game_numbers for each size', () => {
      for (const size of [4, 8, 16, 32, 64]) {
        const templates = generateDEBracketTemplates(size);
        const gameNumbers = templates.map((t) => t.game_number);
        const uniqueNumbers = new Set(gameNumbers);

        expect(uniqueNumbers.size).toBe(templates.length);
      }
    });

    it('should have valid winner_advances_to references', () => {
      for (const size of [4, 8, 16, 32, 64]) {
        const templates = generateDEBracketTemplates(size);
        const gameNumbers = new Set(templates.map((t) => t.game_number));

        for (const template of templates) {
          if (template.winner_advances_to !== null) {
            expect(gameNumbers.has(template.winner_advances_to)).toBe(true);
          }
        }
      }
    });

    it('should have valid loser_advances_to references', () => {
      for (const size of [4, 8, 16, 32, 64]) {
        const templates = generateDEBracketTemplates(size);
        const gameNumbers = new Set(templates.map((t) => t.game_number));

        for (const template of templates) {
          if (template.loser_advances_to !== null) {
            expect(gameNumbers.has(template.loser_advances_to)).toBe(true);
          }
        }
      }
    });

    it('should have valid team sources', () => {
      const validSourcePattern = /^(seed:\d+|winner:\d+|loser:\d+)$/;

      for (const size of [4, 8, 16, 32, 64]) {
        const templates = generateDEBracketTemplates(size);
        const gameNumbers = new Set(templates.map((t) => t.game_number));

        for (const template of templates) {
          // Validate format
          expect(template.team1_source).toMatch(validSourcePattern);
          expect(template.team2_source).toMatch(validSourcePattern);

          // Validate seed references
          if (template.team1_source.startsWith('seed:')) {
            const seedNum = parseInt(template.team1_source.split(':')[1], 10);
            expect(seedNum).toBeGreaterThan(0);
            expect(seedNum).toBeLessThanOrEqual(size);
          }
          if (template.team2_source.startsWith('seed:')) {
            const seedNum = parseInt(template.team2_source.split(':')[1], 10);
            expect(seedNum).toBeGreaterThan(0);
            expect(seedNum).toBeLessThanOrEqual(size);
          }

          // Validate winner/loser references point to existing games
          if (
            template.team1_source.startsWith('winner:') ||
            template.team1_source.startsWith('loser:')
          ) {
            const gameNum = parseInt(template.team1_source.split(':')[1], 10);
            expect(gameNumbers.has(gameNum)).toBe(true);
          }
          if (
            template.team2_source.startsWith('winner:') ||
            template.team2_source.startsWith('loser:')
          ) {
            const gameNum = parseInt(template.team2_source.split(':')[1], 10);
            expect(gameNumbers.has(gameNum)).toBe(true);
          }
        }
      }
    });

    it('should have exactly one championship game per size', () => {
      for (const size of [4, 8, 16, 32, 64]) {
        const templates = generateDEBracketTemplates(size);
        const championships = templates.filter((t) => t.is_championship);

        expect(championships).toHaveLength(1);
      }
    });

    it('should have exactly one grand final game per size', () => {
      for (const size of [4, 8, 16, 32, 64]) {
        const templates = generateDEBracketTemplates(size);
        const grandFinals = templates.filter((t) => t.is_grand_final);

        expect(grandFinals).toHaveLength(1);
      }
    });

    it('should have exactly one reset game per size', () => {
      for (const size of [4, 8, 16, 32, 64]) {
        const templates = generateDEBracketTemplates(size);
        const resetGames = templates.filter((t) => t.is_reset_game);

        expect(resetGames).toHaveLength(1);
        // Reset game should be in finals bracket_side
        expect(resetGames[0].bracket_side).toBe('finals');
      }
    });

    it('should throw for unsupported bracket sizes', () => {
      expect(() => generateDEBracketTemplates(3)).toThrow(
        /Unsupported bracket size/,
      );
      expect(() => generateDEBracketTemplates(10)).toThrow(
        /Unsupported bracket size/,
      );
      expect(() => generateDEBracketTemplates(128)).toThrow(
        /Unsupported bracket size/,
      );
    });
  });
});
