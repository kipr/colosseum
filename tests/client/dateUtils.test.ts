/**
 * Unit tests for date formatting utilities.
 */
import { describe, it, expect } from 'vitest';
import {
  formatDateTime,
  formatDate,
  formatCalledAt,
  toDateOnlyString,
} from '../../src/client/utils/dateUtils';

describe('toDateOnlyString', () => {
  it('returns "" for null or empty input', () => {
    expect(toDateOnlyString(null)).toBe('');
    expect(toDateOnlyString('')).toBe('');
  });

  it('extracts the date from a date or ISO timestamp', () => {
    expect(toDateOnlyString('2025-03-15')).toBe('2025-03-15');
    expect(toDateOnlyString('2025-03-15T12:30:00.000Z')).toBe('2025-03-15');
  });

  it('returns "" for an unrecognized string', () => {
    expect(toDateOnlyString('not-a-date')).toBe('');
  });
});

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

  it('formats an ISO UTC timestamp in local time', () => {
    const iso = '2025-03-15T12:30:00.000Z';
    expect(formatDateTime(iso)).toBe(new Date(iso).toLocaleString());
  });

  it('handles ISO format with + timezone offset', () => {
    const iso = '2025-03-15T12:30:00+05:30';
    expect(formatDateTime(iso)).toBe(new Date(iso).toLocaleString());
  });

  it('returns original string for invalid date', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
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

  it('formats an ISO UTC timestamp as a local date', () => {
    const iso = '2025-03-15T12:00:00.000Z';
    expect(formatDate(iso)).toBe(new Date(iso).toLocaleDateString());
  });

  it('handles date with + timezone offset', () => {
    const iso = '2025-01-15T14:30:00+00:00';
    expect(formatDate(iso)).toBe(new Date(iso).toLocaleDateString());
  });

  it('returns original string for invalid date', () => {
    expect(formatDate('invalid')).toBe('invalid');
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
    const today = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      14,
      30,
    );
    const result = formatCalledAt(today.toISOString());
    expect(result).toBe(
      today.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      }),
    );
  });

  it('returns date and time when date is not today', () => {
    const iso = '2020-01-15T10:00:00.000Z';
    expect(formatCalledAt(iso)).toBe(
      new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    );
  });

  it('handles date with + timezone offset', () => {
    const result = formatCalledAt('2025-01-10T09:00:00+00:00');
    expect(result).not.toBe('-');
    expect(result).not.toBe('2025-01-10T09:00:00+00:00');
  });

  it('returns original string for invalid date', () => {
    expect(formatCalledAt('invalid')).toBe('invalid');
  });
});
