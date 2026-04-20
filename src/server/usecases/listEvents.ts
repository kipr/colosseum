import type { Database } from '../database/connection';

export interface ListEventsParams {
  db: Database;
  status?: string;
}

export type ListEventsResult = {
  ok: true;
  events: Record<string, unknown>[];
};

/** List events, optionally filtered by status. */
export async function listEvents(
  params: ListEventsParams,
): Promise<ListEventsResult> {
  const { db, status } = params;

  let query = 'SELECT * FROM events';
  const queryParams: string[] = [];

  if (status) {
    query += ' WHERE status = ?';
    queryParams.push(status);
  }

  query += ' ORDER BY event_date DESC, created_at DESC';

  const events = await db.all(query, queryParams);
  return { ok: true, events };
}
