import type { Database } from '../database/connection';
import type { PublicEvent } from '../../shared/domain/event';
import { SPECTATOR_EXCLUDED_STATUSES } from '../../shared/domain/eventVisibility';
import { PUBLIC_EVENT_FIELDS, toPublicEvent } from './eventProjection';

export interface ListPublicEventsParams {
  db: Database;
}

export type ListPublicEventsResult = {
  ok: true;
  events: PublicEvent[];
};

/**
 * List events visible to public/spectator consumers. Statuses listed in
 * `SPECTATOR_EXCLUDED_STATUSES` (currently `archived`) are hidden.
 */
export async function listPublicEvents(
  params: ListPublicEventsParams,
): Promise<ListPublicEventsResult> {
  const { db } = params;
  const excluded = SPECTATOR_EXCLUDED_STATUSES.map((s) => `'${s}'`).join(', ');
  const rows = await db.all(
    `SELECT ${PUBLIC_EVENT_FIELDS} FROM events
     WHERE status NOT IN (${excluded})
     ORDER BY event_date DESC, created_at DESC`,
  );
  return { ok: true, events: rows.map(toPublicEvent) };
}
