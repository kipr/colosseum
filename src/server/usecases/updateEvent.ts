import type { Database } from '../database/connection';
import { ALLOWED_UPDATE_FIELDS } from './eventProjection';

export interface UpdateEventParams {
  db: Database;
  eventId: number | string;
  body: Record<string, unknown>;
}

export type UpdateEventResult =
  | { ok: true; event: Record<string, unknown> }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Apply a partial update to an event. Only fields in
 * `ALLOWED_UPDATE_FIELDS` are honored. When `status` moves away from
 * `complete`, `spectator_results_released` is auto-cleared unless the
 * caller is also updating it explicitly.
 */
export async function updateEvent(
  params: UpdateEventParams,
): Promise<UpdateEventResult> {
  const { db, eventId, body } = params;

  // Filter to only allowed fields
  const updates: [string, unknown][] = Object.entries(body).filter(([key]) =>
    ALLOWED_UPDATE_FIELDS.includes(key),
  );

  if (updates.length === 0) {
    return { ok: false, status: 400, error: 'No valid fields to update' };
  }

  // If status is changing away from 'complete', auto-clear spectator release
  const statusUpdate = updates.find(([key]) => key === 'status');
  if (
    statusUpdate &&
    statusUpdate[1] !== 'complete' &&
    !updates.some(([key]) => key === 'spectator_results_released')
  ) {
    updates.push(['spectator_results_released', 0]);
  }

  const setClause = updates.map(([key]) => `${key} = ?`).join(', ');
  const values = updates.map(([, value]) => value);

  const result = await db.run(`UPDATE events SET ${setClause} WHERE id = ?`, [
    ...values,
    eventId,
  ]);

  if (result.changes === 0) {
    return { ok: false, status: 404, error: 'Event not found' };
  }

  const event = await db.get('SELECT * FROM events WHERE id = ?', [eventId]);
  return { ok: true, event: event ?? {} };
}
