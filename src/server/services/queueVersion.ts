import type { Database } from '../database/connection';
import { isForeignKeyConstraintError } from '../database/constraintErrors';

/**
 * Per-event queue version tracking, backed by the `queue_versions` table.
 *
 * - `version` increments on every change that affects queue reads. It drives
 *   the ETag on queue endpoints so pollers get cheap 304 responses when
 *   nothing changed.
 * - `dirty` is set by mutations that can cause the materialized `game_queue`
 *   to drift from source-of-truth tables (score accepts, bracket advances,
 *   team changes, ...). The next read runs one coalesced repair sync and
 *   clears the flag, keeping the sync cost off the polling hot path.
 *
 * A missing row is reported as `{ version: 0, dirty: true }` so brand-new
 * events (and fresh deployments) are synced on first read.
 */
export interface QueueVersionState {
  version: number;
  dirty: boolean;
}

export async function getQueueVersionState(
  db: Database,
  eventId: number,
): Promise<QueueVersionState> {
  const row = await db.get<{ version: number; dirty: number }>(
    'SELECT version, dirty FROM queue_versions WHERE event_id = ?',
    [eventId],
  );
  if (!row) {
    return { version: 0, dirty: true };
  }
  return { version: Number(row.version), dirty: !!Number(row.dirty) };
}

/** Increment the event's queue version. Call after any direct queue change. */
export async function bumpQueueVersion(
  db: Database,
  eventId: number,
): Promise<void> {
  try {
    // Table-qualified names in DO UPDATE refer to the existing row.
    await db.run(
      `INSERT INTO queue_versions (event_id, version, dirty) VALUES (?, 1, 0)
       ON CONFLICT (event_id) DO UPDATE SET version = queue_versions.version + 1`,
      [eventId],
    );
  } catch (error) {
    // Event may have been deleted concurrently; nothing to version then.
    if (!isForeignKeyConstraintError(error)) throw error;
  }
}

/**
 * Increment the version AND flag the queue as needing a repair sync.
 * Call after mutations that change queue eligibility outside game_queue
 * (score accepts, bracket/team/match changes).
 */
export async function markQueueDirty(
  db: Database,
  eventId: number,
): Promise<void> {
  try {
    await db.run(
      `INSERT INTO queue_versions (event_id, version, dirty) VALUES (?, 1, 1)
       ON CONFLICT (event_id) DO UPDATE SET version = queue_versions.version + 1, dirty = 1`,
      [eventId],
    );
  } catch (error) {
    if (!isForeignKeyConstraintError(error)) throw error;
  }
}

/**
 * Clear the dirty flag, but only if the version still matches `expectedVersion`.
 * If another mutation bumped the version while the repair sync was running,
 * the flag stays set and the next read syncs again.
 */
export async function clearQueueDirty(
  db: Database,
  eventId: number,
  expectedVersion: number,
): Promise<void> {
  try {
    await db.run(
      `INSERT INTO queue_versions (event_id, version, dirty) VALUES (?, 1, 0)
       ON CONFLICT (event_id) DO UPDATE SET dirty = 0
       WHERE queue_versions.version = ?`,
      [eventId, expectedVersion],
    );
  } catch (error) {
    if (!isForeignKeyConstraintError(error)) throw error;
  }
}

/** Weak ETag for queue-derived responses of an event. */
export function queueEtag(version: number): string {
  return `W/"queue-v${version}"`;
}
