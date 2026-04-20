import type { Database } from '../database/connection';
import { createAuditEntry } from '../routes/audit';
import { toAuditJson } from '../utils/auditJson';

export interface CheckInTeamParams {
  db: Database;
  teamId: number | string;
  userId: number | null;
  ipAddress: string | null;
}

export type CheckInTeamResult =
  | { ok: true; team: Record<string, unknown> }
  | { ok: false; status: 404; error: string };

/** Mark a team as `checked_in` with the current timestamp; audited. */
export async function checkInTeam(
  params: CheckInTeamParams,
): Promise<CheckInTeamResult> {
  const { db, teamId, userId, ipAddress } = params;

  const oldTeam = await db.get('SELECT * FROM teams WHERE id = ?', [teamId]);
  if (!oldTeam) {
    return { ok: false, status: 404, error: 'Team not found' };
  }

  const result = await db.run(
    `UPDATE teams SET status = 'checked_in', checked_in_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [teamId],
  );

  if (result.changes === 0) {
    return { ok: false, status: 404, error: 'Team not found' };
  }

  const team = await db.get('SELECT * FROM teams WHERE id = ?', [teamId]);

  await createAuditEntry(db, {
    event_id: oldTeam.event_id,
    user_id: userId,
    action: 'team_checked_in',
    entity_type: 'team',
    entity_id: Number(teamId),
    old_value: toAuditJson(oldTeam),
    new_value: toAuditJson(team),
    ip_address: ipAddress,
  });

  return { ok: true, team: team ?? {} };
}
