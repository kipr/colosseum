import type { Database } from '../database/connection';

export interface GetEventParams {
  db: Database;
  eventId: number | string;
}

export type GetEventResult =
  | { ok: true; event: Record<string, unknown> }
  | { ok: false; status: 404; error: string };

/** Get a single event by ID for authenticated callers. */
export async function getEvent(
  params: GetEventParams,
): Promise<GetEventResult> {
  const { db, eventId } = params;
  const event = await db.get('SELECT * FROM events WHERE id = ?', [eventId]);
  if (!event) {
    return { ok: false, status: 404, error: 'Event not found' };
  }
  return { ok: true, event };
}
