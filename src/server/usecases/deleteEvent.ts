import type { Database } from '../database/connection';

export interface DeleteEventParams {
  db: Database;
  eventId: number | string;
}

export type DeleteEventResult = { ok: true };

/** Idempotent delete: returns ok regardless of whether the row existed. */
export async function deleteEvent(
  params: DeleteEventParams,
): Promise<DeleteEventResult> {
  const { db, eventId } = params;
  await db.run('DELETE FROM events WHERE id = ?', [eventId]);
  return { ok: true };
}
