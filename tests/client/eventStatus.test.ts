/**
 * Unit tests for event status utilities.
 */
import { describe, it, expect } from 'vitest';
import {
  getEventStatusClass,
  getEventStatusLabel,
  formatEventDate,
  isEventActive,
} from '../../src/client/utils/eventStatus';

describe('getEventStatusClass', () => {
  it('returns event-status-active for active', () => {
    expect(getEventStatusClass('active')).toBe('event-status-active');
  });

  it('returns event-status-setup for setup', () => {
    expect(getEventStatusClass('setup')).toBe('event-status-setup');
  });

  it('returns event-status-complete for complete', () => {
    expect(getEventStatusClass('complete')).toBe('event-status-complete');
  });

  it('returns event-status-archived for archived', () => {
    expect(getEventStatusClass('archived')).toBe('event-status-archived');
  });

  it('returns empty string for unknown status', () => {
    expect(getEventStatusClass('unknown')).toBe('');
    expect(getEventStatusClass('')).toBe('');
  });
});

describe('getEventStatusLabel', () => {
  it('returns Setup for setup', () => {
    expect(getEventStatusLabel('setup')).toBe('Setup');
  });

  it('returns Active for active', () => {
    expect(getEventStatusLabel('active')).toBe('Active');
  });

  it('returns Complete for complete', () => {
    expect(getEventStatusLabel('complete')).toBe('Complete');
  });

  it('returns Archived for archived', () => {
    expect(getEventStatusLabel('archived')).toBe('Archived');
  });

  it('returns the status string for unknown status', () => {
    expect(getEventStatusLabel('unknown')).toBe('unknown');
  });
});

describe('formatEventDate', () => {
  it('returns empty string for null', () => {
    expect(formatEventDate(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatEventDate(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(formatEventDate('')).toBe('');
  });

  it('formats YYYY-MM-DD date string', () => {
    const result = formatEventDate('2025-03-15');
    expect(result).toMatch(/Mar.*15.*2025/);
  });

  it('returns Invalid Date for unparseable string (toLocaleDateString on invalid Date)', () => {
    expect(formatEventDate('not-a-date')).toBe('Invalid Date');
  });
});

describe('isEventActive', () => {
  it('returns true for setup', () => {
    expect(isEventActive('setup')).toBe(true);
  });

  it('returns true for active', () => {
    expect(isEventActive('active')).toBe(true);
  });

  it('returns false for complete', () => {
    expect(isEventActive('complete')).toBe(false);
  });

  it('returns false for archived', () => {
    expect(isEventActive('archived')).toBe(false);
  });
});
