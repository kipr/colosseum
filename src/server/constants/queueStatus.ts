/** Canonical `game_queue.status` values (v2). */
export const QUEUE_STATUSES = [
  'queued',
  'called',
  'arrived',
  'on_table',
  'scored',
] as const;

export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export const QUEUE_STATUS_SET = new Set<string>(QUEUE_STATUSES);

export function isValidQueueStatus(status: unknown): status is QueueStatus {
  return typeof status === 'string' && QUEUE_STATUS_SET.has(status);
}
