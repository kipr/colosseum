import type { Database } from '../database/connection';
import { createAuditEntry } from '../routes/audit';
import { toAuditJson } from '../utils/auditJson';

export interface DeleteTeamParams {
  db: Database;
  teamId: number | string;
  userId: number | null;
  ipAddress: string | null;
}

export type DeleteTeamResult = { ok: true };

/** Idempotent team delete; audits only when a row was actually present. */
export async function deleteTeam(
  params: DeleteTeamParams,
): Promise<DeleteTeamResult> {
  const { db, teamId, userId, ipAddress } = params;

  const oldTeam = await db.get('SELECT * FROM teams WHERE id = ?', [teamId]);

  await db.run('DELETE FROM teams WHERE id = ?', [teamId]);

  if (oldTeam) {
    await createAuditEntry(db, {
      event_id: oldTeam.event_id,
      user_id: userId,
      action: 'team_deleted',
      entity_type: 'team',
      entity_id: Number(teamId),
      old_value: toAuditJson(oldTeam),
      new_value: null,
      ip_address: ipAddress,
    });
  }

  return { ok: true };
}
