import type { Database } from '../database/connection';
import { createAuditEntry } from '../routes/audit';
import { toAuditJson } from '../utils/auditJson';

const ALLOWED_UPDATE_FIELDS = [
  'team_number',
  'team_name',
  'display_name',
  'status',
];

export interface UpdateTeamParams {
  db: Database;
  teamId: number | string;
  body: Record<string, unknown>;
  userId: number | null;
  ipAddress: string | null;
}

export type UpdateTeamResult =
  | { ok: true; team: Record<string, unknown> }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * Apply a partial update to a team. Only fields in `ALLOWED_UPDATE_FIELDS`
 * are honored; constraint violations surface as 400/409.
 */
export async function updateTeam(
  params: UpdateTeamParams,
): Promise<UpdateTeamResult> {
  const { db, teamId, body, userId, ipAddress } = params;

  const oldTeam = await db.get('SELECT * FROM teams WHERE id = ?', [teamId]);
  if (!oldTeam) {
    return { ok: false, status: 404, error: 'Team not found' };
  }

  const updates = Object.entries(body).filter(([key]) =>
    ALLOWED_UPDATE_FIELDS.includes(key),
  );

  if (updates.length === 0) {
    return { ok: false, status: 400, error: 'No valid fields to update' };
  }

  const setClause = updates.map(([key]) => `${key} = ?`).join(', ');
  const values = updates.map(([, value]) => value);

  let result;
  try {
    result = await db.run(`UPDATE teams SET ${setClause} WHERE id = ?`, [
      ...values,
      teamId,
    ]);
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
    throw error;
  }

  if (result.changes === 0) {
    return { ok: false, status: 404, error: 'Team not found' };
  }

  const team = await db.get('SELECT * FROM teams WHERE id = ?', [teamId]);

  await createAuditEntry(db, {
    event_id: oldTeam.event_id,
    user_id: userId,
    action: 'team_updated',
    entity_type: 'team',
    entity_id: Number(teamId),
    old_value: toAuditJson(oldTeam),
    new_value: toAuditJson(team),
    ip_address: ipAddress,
  });

  return { ok: true, team: team ?? {} };
}
