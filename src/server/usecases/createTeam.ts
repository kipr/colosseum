import type { Database } from '../database/connection';
import { createAuditEntry } from '../routes/audit';
import { toAuditJson } from '../utils/auditJson';

export interface CreateTeamParams {
  db: Database;
  body: Record<string, unknown>;
  userId: number | null;
  ipAddress: string | null;
}

export type CreateTeamResult =
  | { ok: true; team: Record<string, unknown> }
  | { ok: false; status: 400 | 409; error: string };

/**
 * Create a team. Validates required fields and translates SQL constraint
 * violations into 4xx responses; the route only owns 500 fallback.
 */
export async function createTeam(
  params: CreateTeamParams,
): Promise<CreateTeamResult> {
  const { db, body, userId, ipAddress } = params;

  const event_id = body.event_id as number | undefined;
  const team_number = body.team_number as number | undefined;
  const team_name = body.team_name as string | undefined;
  const display_name = body.display_name as string | undefined;
  const status = body.status as string | undefined;

  if (!event_id || !team_number || !team_name) {
    return {
      ok: false,
      status: 400,
      error: 'event_id, team_number, and team_name are required',
    };
  }

  let result;
  try {
    result = await db.run(
      `INSERT INTO teams (event_id, team_number, team_name, display_name, status)
       VALUES (?, ?, ?, ?, ?)`,
      [
        event_id,
        team_number,
        team_name,
        display_name || `${team_number} ${team_name}`,
        status || 'registered',
      ],
    );
  } catch (error) {
    const errMsg = (error as Error).message || '';
    if (errMsg.includes('UNIQUE constraint failed')) {
      return {
        ok: false,
        status: 409,
        error: 'Team number already exists for this event',
      };
    }
    if (errMsg.includes('CHECK constraint failed')) {
      return {
        ok: false,
        status: 400,
        error: 'Invalid team_number or status',
      };
    }
    if (errMsg.includes('FOREIGN KEY constraint failed')) {
      return { ok: false, status: 400, error: 'Event does not exist' };
    }
    throw error;
  }

  const team = await db.get('SELECT * FROM teams WHERE id = ?', [
    result.lastID,
  ]);

  await createAuditEntry(db, {
    event_id,
    user_id: userId,
    action: 'team_added',
    entity_type: 'team',
    entity_id: team?.id ?? result.lastID ?? null,
    old_value: null,
    new_value: toAuditJson(team),
    ip_address: ipAddress,
  });

  return { ok: true, team: team ?? {} };
}
