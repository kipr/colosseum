/**
 * Canonical event/tournament domain enums, DTOs, label maps, and validators.
 *
 * Used by:
 * - DB schema (`src/server/database/init.ts`) to derive CHECK constraints
 * - Server routes/services for visibility & validation
 * - Client UI for status badges and labels
 */

export const EVENT_STATUSES = [
  'setup',
  'active',
  'complete',
  'archived',
] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

const EVENT_STATUS_SET: ReadonlySet<string> = new Set(EVENT_STATUSES);

export function isEventStatus(value: unknown): value is EventStatus {
  return typeof value === 'string' && EVENT_STATUS_SET.has(value);
}

export const SCORE_ACCEPT_MODES = [
  'manual',
  'auto_accept_seeding',
  'auto_accept_all',
] as const;

export type ScoreAcceptMode = (typeof SCORE_ACCEPT_MODES)[number];

const SCORE_ACCEPT_MODE_SET: ReadonlySet<string> = new Set(SCORE_ACCEPT_MODES);

export function isScoreAcceptMode(value: unknown): value is ScoreAcceptMode {
  return typeof value === 'string' && SCORE_ACCEPT_MODE_SET.has(value);
}

/**
 * Statuses hidden from public/spectator surfaces.
 * Single source of truth for `isEventArchived` and any future visibility checks.
 */
export const SPECTATOR_EXCLUDED_STATUSES: readonly EventStatus[] = ['archived'];

/**
 * The status an event must reach before final-results spectator release is allowed.
 */
export const SPECTATOR_FINAL_RESULTS_STATUS: EventStatus = 'complete';

export function isEventArchivedStatus(
  status: string | null | undefined,
): boolean {
  return (
    !!status && SPECTATOR_EXCLUDED_STATUSES.includes(status as EventStatus)
  );
}

export function isEventActive(status: EventStatus | string): boolean {
  return status === 'setup' || status === 'active';
}

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  setup: 'Setup',
  active: 'Active',
  complete: 'Complete',
  archived: 'Archived',
};

export function getEventStatusLabel(status: EventStatus | string): string {
  if (isEventStatus(status)) return EVENT_STATUS_LABELS[status];
  return status;
}

export const EVENT_STATUS_BADGE_CLASSES: Record<EventStatus, string> = {
  setup: 'event-status-setup',
  active: 'event-status-active',
  complete: 'event-status-complete',
  archived: 'event-status-archived',
};

export function getEventStatusClass(status: EventStatus | string): string {
  if (isEventStatus(status)) return EVENT_STATUS_BADGE_CLASSES[status];
  return '';
}

/**
 * Canonical Event DTO returned by the API and consumed by the client.
 */
export interface Event {
  id: number;
  name: string;
  description: string | null;
  event_date: string | null;
  location: string | null;
  status: EventStatus;
  seeding_rounds: number;
  score_accept_mode: ScoreAcceptMode;
  spectator_results_released: boolean;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}
