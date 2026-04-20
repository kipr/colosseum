import type { Database } from '../database/connection';
import { isEventArchived } from '../utils/eventVisibility';

export interface ListSeedingScoresForEventParams {
  db: Database;
  eventId: number | string;
}

export type ListSeedingScoresForEventResult =
  | { ok: true; scores: Record<string, unknown>[] }
  | { ok: false; status: 404; error: string };

/** List all seeding scores for an event. Blocked for archived events. */
export async function listSeedingScoresForEvent(
  params: ListSeedingScoresForEventParams,
): Promise<ListSeedingScoresForEventResult> {
  const { db, eventId } = params;

  if (await isEventArchived(eventId)) {
    return { ok: false, status: 404, error: 'Event not found' };
  }

  const scores = await db.all(
    `SELECT ss.*, t.team_number, t.team_name, t.display_name
     FROM seeding_scores ss
     JOIN teams t ON ss.team_id = t.id
     WHERE t.event_id = ?
     ORDER BY t.team_number ASC, ss.round_number ASC`,
    [eventId],
  );
  return { ok: true, scores };
}
