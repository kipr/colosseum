/**
 * Re-exports the canonical queue status / type definitions from the shared
 * domain layer. New code should import directly from
 * `../../shared/domain/queue`; this module exists for backwards compatibility
 * with the original `src/server/constants/queueStatus` import paths.
 */
export {
  QUEUE_STATUSES,
  QUEUE_STATUS_LABELS,
  isValidQueueStatus,
  type QueueStatus,
} from '../../shared/domain/queue';

import { QUEUE_STATUSES } from '../../shared/domain/queue';

/** @deprecated Prefer `isValidQueueStatus`. Kept for legacy callers. */
export const QUEUE_STATUS_SET = new Set<string>(QUEUE_STATUSES);
