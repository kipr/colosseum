import { getDatabase } from '../database/connection';

const SPECTATOR_EXCLUDED_STATUSES = ['archived'];

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
  return SPECTATOR_EXCLUDED_STATUSES.includes(row.status);
}
