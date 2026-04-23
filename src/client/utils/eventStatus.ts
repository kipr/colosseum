/**
 * Event status types and utilities.
 *
 * Canonical enums, label maps, validators, and the `Event` DTO live in
 * `src/shared/domain/event.ts` so the server, client, and DB schema all use
 * the same definitions.  This file re-exports them and adds client-only
 * `formatEventDate`, which depends on browser locale APIs.
 */

import { toDateOnlyString } from './dateUtils';

export {
  EVENT_STATUSES,
  EVENT_STATUS_LABELS,
  EVENT_STATUS_BADGE_CLASSES,
  type EventStatus,
  SCORE_ACCEPT_MODES,
  type ScoreAcceptMode,
  type Event,
  isEventActive,
  isEventStatus,
  isScoreAcceptMode,
  getEventStatusClass,
  getEventStatusLabel,
} from '../../shared/domain';

/**
 * Format an event date string for display.
 * Handles both SQLite (YYYY-MM-DD) and PostgreSQL (YYYY-MM-DDTHH:mm:ss.sssZ) formats.
 */
export function formatEventDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';

  try {
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
