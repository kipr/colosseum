import type { Database } from '../database/connection';

export interface CreateEventParams {
  db: Database;
  body: Record<string, unknown>;
  userId: number | null;
}

export type CreateEventResult =
  | { ok: true; event: Record<string, unknown> }
  | { ok: false; status: 400; error: string };

/** Create a new event. Validates `name` presence; admin auth is a route concern. */
export async function createEvent(
  params: CreateEventParams,
): Promise<CreateEventResult> {
  const { db, body, userId } = params;

  const name = body.name as string | undefined;
  if (!name) {
    return { ok: false, status: 400, error: 'Event name is required' };
  }

  const description = (body.description as string | undefined) || null;
  const event_date = (body.event_date as string | undefined) || null;
  const location = (body.location as string | undefined) || null;
  const status = (body.status as string | undefined) || 'setup';
  const seeding_rounds = (body.seeding_rounds as number | undefined) ?? 3;
  const score_accept_mode =
    (body.score_accept_mode as string | undefined) || 'manual';

  const result = await db.run(
    `INSERT INTO events (name, description, event_date, location, status, seeding_rounds, score_accept_mode, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      description,
      event_date,
      location,
      status,
      seeding_rounds,
      score_accept_mode,
      userId,
    ],
  );

  const event = await db.get('SELECT * FROM events WHERE id = ?', [
    result.lastID,
  ]);
  return { ok: true, event: event ?? {} };
}
