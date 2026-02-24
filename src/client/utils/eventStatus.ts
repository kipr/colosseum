/**
 * Event status types and utilities
 * These match the database CHECK constraint: status IN ('setup', 'active', 'complete', 'archived')
 */

import { toDateOnlyString } from './dateUtils';

export type EventStatus = 'setup' | 'active' | 'complete' | 'archived';

export type ScoreAcceptMode =
  | 'manual'
  | 'auto_accept_seeding'
  | 'auto_accept_all';

export interface Event {
  id: number;
  name: string;
  description: string | null;
  event_date: string | null;
  location: string | null;
  status: EventStatus;
  seeding_rounds: number;
  score_accept_mode: ScoreAcceptMode;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Get the CSS class for an event status badge/dot
 */
export function getEventStatusClass(status: EventStatus | string): string {
  switch (status) {
    case 'active':
      return 'event-status-active';
    case 'setup':
      return 'event-status-setup';
    case 'complete':
      return 'event-status-complete';
    case 'archived':
      return 'event-status-archived';
    default:
      return '';
  }
}

/**
 * Get a human-readable label for an event status
 */
export function getEventStatusLabel(status: EventStatus | string): string {
  switch (status) {
    case 'setup':
      return 'Setup';
    case 'active':
      return 'Active';
    case 'complete':
      return 'Complete';
    case 'archived':
      return 'Archived';
    default:
      return status;
  }
}

/**
 * Format an event date string for display.
 * Handles both SQLite (YYYY-MM-DD) and PostgreSQL (YYYY-MM-DDTHH:mm:ss.sssZ) formats.
 */
export function formatEventDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';

  try {
    // Extract YYYY-MM-DD - PostgreSQL returns ISO strings, SQLite returns date-only
    const dateOnly = toDateOnlyString(dateStr);
    if (!dateOnly) return dateStr;

    const date = new Date(dateOnly + 'T00:00:00');
    if (Number.isNaN(date.getTime())) return dateStr;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Check if an event status is "active" (not archived or complete)
 */
export function isEventActive(status: EventStatus): boolean {
  return status === 'setup' || status === 'active';
}
