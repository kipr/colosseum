/**
 * Canonical `events.status` values.
 *
 * Mirrors the SQL CHECK constraint on `events.status` (see
 * `src/server/database/init.ts`). Adding/removing a value here also requires a
 * matching schema migration.
 */
export const EVENT_STATUSES = [
  'setup',
  'active',
  'complete',
  'archived',
] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

const EVENT_STATUS_SET = new Set<string>(EVENT_STATUSES);

export function isValidEventStatus(value: unknown): value is EventStatus {
  return typeof value === 'string' && EVENT_STATUS_SET.has(value);
}

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  setup: 'Setup',
  active: 'Active',
  complete: 'Complete',
  archived: 'Archived',
};

/** CSS class name for an event status badge/dot. */
export const EVENT_STATUS_CLASSES: Record<EventStatus, string> = {
  setup: 'event-status-setup',
  active: 'event-status-active',
  complete: 'event-status-complete',
  archived: 'event-status-archived',
};

export function getEventStatusLabel(status: EventStatus | string): string {
  return isValidEventStatus(status) ? EVENT_STATUS_LABELS[status] : status;
}

export function getEventStatusClass(status: EventStatus | string): string {
  return isValidEventStatus(status) ? EVENT_STATUS_CLASSES[status] : '';
}

/** "Active" means the event is in setup or active state (not complete/archived). */
export function isEventActive(status: EventStatus | string): boolean {
  return status === 'setup' || status === 'active';
}
