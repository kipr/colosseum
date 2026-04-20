/**
 * Canonical `game_queue.status` and `game_queue.queue_type` values (v2).
 *
 * Mirrors the SQL CHECK constraints on `game_queue` (see
 * `src/server/database/init.ts` and the v2 migration).
 *
 * `QUEUE_STATUSES` defines the canonical lifecycle order of a queued game:
 * queued → called → arrived → on_table → scored.
 */
export const QUEUE_STATUSES = [
  'queued',
  'called',
  'arrived',
  'on_table',
  'scored',
] as const;

export type QueueStatus = (typeof QUEUE_STATUSES)[number];

const QUEUE_STATUS_SET = new Set<string>(QUEUE_STATUSES);

export function isValidQueueStatus(value: unknown): value is QueueStatus {
  return typeof value === 'string' && QUEUE_STATUS_SET.has(value);
}

export const QUEUE_STATUS_LABELS: Record<QueueStatus, string> = {
  queued: 'Queued',
  called: 'Called',
  arrived: 'Arrived',
  on_table: 'On table',
  scored: 'Scored',
};

/** CSS class for a queue status badge (matches `queue-status-*` rules). */
export function getQueueStatusClass(status: QueueStatus): string {
  return `queue-status-${status.replace(/_/g, '-')}`;
}

/** CSS class for the row tint corresponding to a queue status. */
export function getQueueRowStatusClass(status: QueueStatus): string {
  return `queue-row--${status.replace(/_/g, '-')}`;
}

/** Next status in the queue flow, or `null` if already at the terminal state. */
export function getNextQueueStatus(current: QueueStatus): QueueStatus | null {
  const idx = QUEUE_STATUSES.indexOf(current);
  if (idx < 0 || idx >= QUEUE_STATUSES.length - 1) return null;
  return QUEUE_STATUSES[idx + 1]!;
}

/** Previous status in the queue flow, or `null` if at the initial state. */
export function getPrevQueueStatus(current: QueueStatus): QueueStatus | null {
  const idx = QUEUE_STATUSES.indexOf(current);
  if (idx <= 0) return null;
  return QUEUE_STATUSES[idx - 1]!;
}

/**
 * Canonical `game_queue.queue_type` values.
 */
export const QUEUE_TYPES = ['seeding', 'bracket'] as const;

export type QueueType = (typeof QUEUE_TYPES)[number];

const QUEUE_TYPE_SET = new Set<string>(QUEUE_TYPES);

export function isValidQueueType(value: unknown): value is QueueType {
  return typeof value === 'string' && QUEUE_TYPE_SET.has(value);
}

export const QUEUE_TYPE_LABELS: Record<QueueType, string> = {
  seeding: 'Seeding',
  bracket: 'Bracket',
};
