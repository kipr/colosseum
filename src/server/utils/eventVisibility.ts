import { getDatabase } from '../database/connection';
import {
  SPECTATOR_EXCLUDED_STATUSES,
  SPECTATOR_FINAL_RESULTS_STATUS,
  isEventArchivedStatus,
} from '../../shared/domain';

/**
 * Check whether the given event has a status that should be hidden from
 * public / spectator consumers.  Returns `true` when the event is archived
 * (or does not exist).
 */
export async function isEventArchived(
  eventId: number | string,
): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.get<{ status: string }>(
    'SELECT status FROM events WHERE id = ?',
    [eventId],
  );
  if (!row) return true;
  return isEventArchivedStatus(row.status);
}

/**
 * Check whether final scores (documentation, bracket rankings, overall) have
 * been released for spectator consumption.  Returns `true` only when the event
 * exists, has the canonical "final-results" status (see
 * `SPECTATOR_FINAL_RESULTS_STATUS`), and the admin has toggled release on.
 */
export async function areFinalScoresReleased(
  eventId: number | string,
): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.get<{
    status: string;
    spectator_results_released: number;
  }>('SELECT status, spectator_results_released FROM events WHERE id = ?', [
    eventId,
  ]);
  if (!row) return false;
  return (
    row.status === SPECTATOR_FINAL_RESULTS_STATUS &&
    !!row.spectator_results_released
  );
}

// Re-exported so visibility callers never need to reach into `shared/domain`
// just to read the canonical exclusion list.
export { SPECTATOR_EXCLUDED_STATUSES };
