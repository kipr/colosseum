/**
 * Re-exports the canonical event status / score-accept-mode definitions and
 * the shared `Event` DTO from `src/shared/domain/`. Date-formatting helpers
 * remain here since they depend on client-only `dateUtils`.
 */
import { toDateOnlyString } from './dateUtils';

export {
  EVENT_STATUSES,
  EVENT_STATUS_LABELS,
  EVENT_STATUS_CLASSES,
  isValidEventStatus,
  getEventStatusLabel,
  getEventStatusClass,
  isEventActive,
  type EventStatus,
} from '@shared/domain/eventStatus';

export {
  SCORE_ACCEPT_MODES,
  SCORE_ACCEPT_MODE_LABELS,
  isValidScoreAcceptMode,
  type ScoreAcceptMode,
} from '@shared/domain/scoreAcceptMode';

export type { Event, PublicEvent } from '@shared/domain/event';

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
