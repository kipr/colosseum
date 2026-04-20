import type { Database } from '../database/connection';
import { isEventArchived } from '../utils/eventVisibility';

export interface ListSeedingRankingsParams {
  db: Database;
  eventId: number | string;
}

export type ListSeedingRankingsResult =
  | { ok: true; rankings: Record<string, unknown>[] }
  | { ok: false; status: 404; error: string };

const RANKINGS_QUERY = `SELECT sr.*, t.team_number, t.team_name, t.display_name
   FROM seeding_rankings sr
   JOIN teams t ON sr.team_id = t.id
   WHERE t.event_id = ?
   ORDER BY sr.seed_rank ASC NULLS LAST`;

/** Fetch the rankings rows for an event. Reused by recalculate. */
export async function fetchSeedingRankings(
  db: Database,
  eventId: number | string,
): Promise<Record<string, unknown>[]> {
  return db.all(RANKINGS_QUERY, [eventId]);
}

/** List seeding rankings for an event. Blocked for archived events. */
export async function listSeedingRankings(
  params: ListSeedingRankingsParams,
): Promise<ListSeedingRankingsResult> {
  const { db, eventId } = params;

  if (await isEventArchived(eventId)) {
    return { ok: false, status: 404, error: 'Event not found' };
  }

  const rankings = await fetchSeedingRankings(db, eventId);
  return { ok: true, rankings };
}
