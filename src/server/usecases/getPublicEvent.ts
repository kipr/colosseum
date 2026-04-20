import type { Database } from '../database/connection';
import type { PublicEvent } from '../../shared/domain/event';
import { isEventArchived } from '../utils/eventVisibility';
import { PUBLIC_EVENT_FIELDS, toPublicEvent } from './eventProjection';

export interface GetPublicEventParams {
  db: Database;
  eventId: number | string;
}

export type GetPublicEventResult =
  | { ok: true; event: PublicEvent }
  | { ok: false; status: 404; error: string };

/** Get the public projection of a single event, gated on spectator visibility. */
export async function getPublicEvent(
  params: GetPublicEventParams,
): Promise<GetPublicEventResult> {
  const { db, eventId } = params;

  if (await isEventArchived(eventId)) {
    return { ok: false, status: 404, error: 'Event not found' };
  }

  const row = await db.get(
    `SELECT ${PUBLIC_EVENT_FIELDS} FROM events WHERE id = ?`,
    [eventId],
  );
  if (!row) {
    return { ok: false, status: 404, error: 'Event not found' };
  }
  return { ok: true, event: toPublicEvent(row) };
}
