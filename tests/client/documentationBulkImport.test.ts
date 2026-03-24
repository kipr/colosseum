import { describe, expect, it } from 'vitest';
import {
  buildBulkImportSubScores,
  parseDocScoresText,
} from '../../src/client/components/admin/documentationBulkImport';

describe('documentationBulkImport', () => {
  describe('parseDocScoresText', () => {
    it('parses all-category rows with an optional header', () => {
      const result = parseDocScoresText(
        'team_number,design,engineering\n101,15,18\n102,20,16',
        2,
      );

      expect(result.errors).toEqual([]);
      expect(result.rows).toEqual([
        { team_number: 101, scores: [15, 18] },
        { team_number: 102, scores: [20, 16] },
      ]);
    });

    it('parses single-category imports with two columns', () => {
      const result = parseDocScoresText('team_number\tinnovation\n101\t9.5', 1);

      expect(result.errors).toEqual([]);
      expect(result.rows).toEqual([{ team_number: 101, scores: [9.5] }]);
    });
  });

  describe('buildBulkImportSubScores', () => {
    it('keeps current behavior when importing all categories', () => {
      const result = buildBulkImportSubScores({
        categories: [{ id: 11 }, { id: 22 }, { id: 33 }],
        rowScores: [5, 6, 7],
        selectedCategoryId: null,
      });

      expect(result).toEqual([
        { category_id: 11, score: 5 },
        { category_id: 22, score: 6 },
        { category_id: 33, score: 7 },
      ]);
    });

    it('merges a single-category import with existing scores', () => {
      const result = buildBulkImportSubScores({
        categories: [{ id: 11 }, { id: 22 }, { id: 33 }],
        rowScores: [9],
        selectedCategoryId: 22,
        existingSubScores: [
          { category_id: 11, score: 3 },
          { category_id: 22, score: 4 },
        ],
      });

      expect(result).toEqual([
        { category_id: 11, score: 3 },
        { category_id: 22, score: 9 },
      ]);
    });
  });
});
