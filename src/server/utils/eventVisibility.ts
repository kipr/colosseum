import { getDatabase } from '../database/connection';
import {
  isFinalScoresReleasedFor,
  isStatusSpectatorVisible,
} from '../../shared/domain/eventVisibility';

/**
 * Check whether the given event has a status that should be hidden from
 * public / spectator consumers.  Returns `true` when the event is archived
 * (or does not exist).
 *
 * The status-based predicate lives in the shared domain layer
 * (`SPECTATOR_EXCLUDED_STATUSES`) so client code can apply the same rule
 * without round-tripping to the API.
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
  return !isStatusSpectatorVisible(row.status);
}

/**
 * Check whether final scores (documentation, bracket rankings, overall) have
 * been released for spectator consumption.  Returns `true` only when the event
 * exists, has status 'complete', and the admin has toggled release on.
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
  return isFinalScoresReleasedFor(row.status, row.spectator_results_released);
}
