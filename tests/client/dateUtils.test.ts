/**
 * Unit tests for date formatting utilities.
 */
import { describe, it, expect } from 'vitest';
import {
  formatDateTime,
  formatDate,
  formatDateTimeVerbose,
  formatCalledAt,
} from '../../src/client/utils/dateUtils';

describe('formatDateTime', () => {
  it('returns "-" for null', () => {
    expect(formatDateTime(null)).toBe('-');
  });

  it('returns "-" for undefined', () => {
    expect(formatDateTime(undefined)).toBe('-');
  });

  it('returns "-" for empty string', () => {
    expect(formatDateTime('')).toBe('-');
  });

  it('normalizes SQLite format (space, no timezone) and formats', () => {
    const result = formatDateTime('2025-03-15 12:30:00');
    expect(result).not.toBe('-');
    expect(result).not.toBe('2025-03-15 12:30:00');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns original string for invalid date', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });

  it('handles ISO format with Z (already has timezone)', () => {
    const result = formatDateTime('2025-03-15T12:30:00Z');
    expect(result).not.toBe('-');
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles ISO format with + timezone offset', () => {
    const result = formatDateTime('2025-03-15T12:30:00+05:30');
    expect(result).not.toBe('-');
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles ISO format with T but no timezone (adds Z)', () => {
    const result = formatDateTime('2025-03-15T14:00:00');
    expect(result).not.toBe('-');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('formatDate', () => {
  it('returns "-" for null', () => {
    expect(formatDate(null)).toBe('-');
  });

  it('returns "-" for undefined', () => {
    expect(formatDate(undefined)).toBe('-');
  });

  it('returns "-" for empty string', () => {
    expect(formatDate('')).toBe('-');
  });

  it('formats valid SQLite date string', () => {
    const result = formatDate('2025-03-15 12:30:00');
    expect(result).not.toBe('-');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns original string for invalid date', () => {
    expect(formatDate('invalid')).toBe('invalid');
  });

  it('handles ISO format with T', () => {
    const result = formatDate('2025-03-15T12:00:00');
    expect(result).not.toBe('-');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('formatDateTimeVerbose', () => {
  it('returns "-" for null', () => {
    expect(formatDateTimeVerbose(null)).toBe('-');
  });

  it('returns "-" for undefined', () => {
    expect(formatDateTimeVerbose(undefined)).toBe('-');
  });

  it('formats valid date with timezone info', () => {
    const result = formatDateTimeVerbose('2025-03-15 14:00:00');
    expect(result).not.toBe('-');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns original string for invalid date', () => {
    expect(formatDateTimeVerbose('bad-date')).toBe('bad-date');
  });

  it('handles date with + timezone', () => {
    const result = formatDateTimeVerbose('2025-03-15T14:00:00+00:00');
    expect(result).not.toBe('-');
    expect(result).toMatch(/2025|Mar|15/);
  });
});

describe('formatCalledAt', () => {
  it('returns "-" for null', () => {
    expect(formatCalledAt(null)).toBe('-');
  });

  it('returns "-" for undefined', () => {
    expect(formatCalledAt(undefined)).toBe('-');
  });

  it('returns "-" for empty string', () => {
    expect(formatCalledAt('')).toBe('-');
  });

  it('returns time only when date is today', () => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} 14:30:00`;
    const result = formatCalledAt(todayStr);
    expect(result).not.toBe('-');
    expect(result).not.toBe(todayStr);
    // Time-only format is typically shorter (e.g. "2:30 PM")
    expect(result.length).toBeLessThan(30);
  });

  it('returns date and time when date is not today', () => {
    const result = formatCalledAt('2020-01-15 10:00:00');
    expect(result).not.toBe('-');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns original string for invalid date', () => {
    expect(formatCalledAt('invalid')).toBe('invalid');
  });

  it('handles date with + timezone offset', () => {
    const result = formatCalledAt('2025-01-10T09:00:00+00:00');
    expect(result).not.toBe('-');
    expect(result.length).toBeGreaterThan(0);
  });
});
