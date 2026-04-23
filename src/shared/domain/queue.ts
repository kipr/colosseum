/**
 * Canonical game-queue domain enums (v2), label maps, and helpers.
 *
 * The queue is the per-event ordered list of seeding rounds and bracket games
 * waiting to be played. `QueueStatus` is the v2 enum (legacy values are
 * migrated by `migrateGameQueueStatusV2*` in `src/server/database/init.ts`).
 */

export const QUEUE_STATUSES = [
  'queued',
  'called',
  'arrived',
  'on_table',
  'scored',
] as const;

export type QueueStatus = (typeof QUEUE_STATUSES)[number];

const QUEUE_STATUS_SET: ReadonlySet<string> = new Set(QUEUE_STATUSES);

export function isValidQueueStatus(value: unknown): value is QueueStatus {
  return typeof value === 'string' && QUEUE_STATUS_SET.has(value);
}

export const QUEUE_TYPES = ['seeding', 'bracket'] as const;
export type QueueType = (typeof QUEUE_TYPES)[number];

const QUEUE_TYPE_SET: ReadonlySet<string> = new Set(QUEUE_TYPES);

export function isQueueType(value: unknown): value is QueueType {
  return typeof value === 'string' && QUEUE_TYPE_SET.has(value);
}

export const QUEUE_STATUS_LABELS: Record<QueueStatus, string> = {
  queued: 'Queued',
  called: 'Called',
  arrived: 'Arrived',
  on_table: 'On table',
  scored: 'Scored',
};

/** Canonical workflow ordering for a queue item. */
export const QUEUE_STATUS_ORDER = QUEUE_STATUSES;

/** Next status in the queue flow, or null if already at the terminal state. */
export function getNextQueueStatus(current: QueueStatus): QueueStatus | null {
  const idx = QUEUE_STATUS_ORDER.indexOf(current);
  if (idx < 0 || idx >= QUEUE_STATUS_ORDER.length - 1) return null;
  return QUEUE_STATUS_ORDER[idx + 1]!;
}
