import type { Database } from '../database/connection';
import { isEventArchived } from '../utils/eventVisibility';

export interface ListTeamsParams {
  db: Database;
  eventId: number | string;
  status?: string;
}

export type ListTeamsResult =
  | { ok: true; teams: Record<string, unknown>[] }
  | { ok: false; status: 404; error: string };

/** List teams for an event, optionally filtered by status. Blocked for archived events. */
export async function listTeams(
  params: ListTeamsParams,
): Promise<ListTeamsResult> {
  const { db, eventId, status } = params;

  if (await isEventArchived(eventId)) {
    return { ok: false, status: 404, error: 'Event not found' };
  }

  let query = 'SELECT * FROM teams WHERE event_id = ?';
  const queryParams: (string | number)[] = [eventId];

  if (status) {
    query += ' AND status = ?';
    queryParams.push(status);
  }

  query += ' ORDER BY team_number ASC';

  const teams = await db.all(query, queryParams);
  return { ok: true, teams };
}
