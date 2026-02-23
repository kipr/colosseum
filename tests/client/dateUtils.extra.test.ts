/**
 * Additional date utility tests targeting uncovered branches.
 * Covers formatDateTimeVerbose, formatCalledAt edge cases, invalid dates, catch blocks.
 */
import { describe, it, expect } from 'vitest';
import {
  formatDateTime,
  formatDate,
  formatDateTimeVerbose,
  formatCalledAt,
} from '../../src/client/utils/dateUtils';

describe('dateUtils - additional coverage', () => {
  describe('formatDateTimeVerbose', () => {
    it('returns "-" for null', () => {
      expect(formatDateTimeVerbose(null)).toBe('-');
    });

    it('returns "-" for undefined', () => {
      expect(formatDateTimeVerbose(undefined)).toBe('-');
    });

    it('formats SQLite date', () => {
      const result = formatDateTimeVerbose('2025-01-15 14:30:00');
      expect(result).not.toBe('-');
      expect(result).not.toBe('2025-01-15 14:30:00');
    });

    it('formats ISO date without timezone', () => {
      const result = formatDateTimeVerbose('2025-01-15T14:30:00');
      expect(result).not.toBe('-');
    });

    it('formats ISO date with Z suffix', () => {
      const result = formatDateTimeVerbose('2025-01-15T14:30:00Z');
      expect(result).not.toBe('-');
    });

    it('formats date with + timezone', () => {
      const result = formatDateTimeVerbose('2025-01-15T14:30:00+05:00');
      expect(result).not.toBe('-');
    });

    it('returns original string for invalid date', () => {
      const result = formatDateTimeVerbose('not-a-date');
      expect(result).toBe('not-a-date');
    });
  });

  describe('formatCalledAt', () => {
    it('returns "-" for null', () => {
      expect(formatCalledAt(null)).toBe('-');
    });

    it('returns "-" for undefined', () => {
      expect(formatCalledAt(undefined)).toBe('-');
    });

    it('shows time only for today', () => {
      const now = new Date();
      const isoString = now.toISOString();
      const result = formatCalledAt(isoString);
      expect(result).not.toBe('-');
      expect(result).not.toBe(isoString);
    });

    it('shows date + time for non-today dates', () => {
      const result = formatCalledAt('2020-01-15 14:30:00');
      expect(result).not.toBe('-');
    });

    it('handles SQLite format', () => {
      const result = formatCalledAt('2025-06-15 09:00:00');
      expect(result).not.toBe('-');
    });

    it('handles ISO format without Z', () => {
      const result = formatCalledAt('2025-06-15T09:00:00');
      expect(result).not.toBe('-');
    });

    it('returns original string for invalid date', () => {
      expect(formatCalledAt('garbage')).toBe('garbage');
    });
  });

  describe('formatDateTime - edge cases', () => {
    it('handles date with + timezone offset', () => {
      const result = formatDateTime('2025-01-15T14:30:00+00:00');
      expect(result).not.toBe('-');
    });
  });

  describe('formatDate - edge cases', () => {
    it('handles date with + timezone offset', () => {
      const result = formatDate('2025-01-15T14:30:00+00:00');
      expect(result).not.toBe('-');
    });

    it('returns original string for invalid date', () => {
      expect(formatDate('not-a-date')).toBe('not-a-date');
    });
  });
});
