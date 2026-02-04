/**
 * Bracket template seeding tests - verify templates are generated correctly
 * and that seeding is idempotent.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from './helpers/testDb';
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
  });

  describe('generateDEBracketTemplates', () => {
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
          if (template.team1_source.startsWith('winner:') || template.team1_source.startsWith('loser:')) {
            const gameNum = parseInt(template.team1_source.split(':')[1], 10);
            expect(gameNumbers.has(gameNum)).toBe(true);
          }
          if (template.team2_source.startsWith('winner:') || template.team2_source.startsWith('loser:')) {
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
      expect(() => generateDEBracketTemplates(3)).toThrow(/Unsupported bracket size/);
      expect(() => generateDEBracketTemplates(10)).toThrow(/Unsupported bracket size/);
      expect(() => generateDEBracketTemplates(128)).toThrow(/Unsupported bracket size/);
    });
  });
});
