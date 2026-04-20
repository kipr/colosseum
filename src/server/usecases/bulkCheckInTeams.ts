import type { Database } from '../database/connection';
import { createAuditEntry } from '../routes/audit';
import { toAuditJson } from '../utils/auditJson';

export interface BulkCheckInTeamsParams {
  db: Database;
  eventId: number | string;
  body: Record<string, unknown>;
  userId: number | null;
  ipAddress: string | null;
}

export type BulkCheckInTeamsResult =
  | { ok: true; updated: number; not_found?: number[] }
  | { ok: false; status: 400; error: string };

/**
 * Check in many teams by team_number for an event in one transaction.
 * Numbers that don't resolve are reported in `not_found` rather than failing.
 */
export async function bulkCheckInTeams(
  params: BulkCheckInTeamsParams,
): Promise<BulkCheckInTeamsResult> {
  const { db, eventId, body, userId, ipAddress } = params;

  const team_numbers = body.team_numbers as number[] | undefined;
  if (!Array.isArray(team_numbers) || team_numbers.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'team_numbers array is required',
    };
  }

  const event = await db.get('SELECT id FROM events WHERE id = ?', [eventId]);
  if (!event) {
    return { ok: false, status: 400, error: 'Event does not exist' };
  }

  const existingTeams = await db.all<{ id: number; team_number: number }>(
    `SELECT id, team_number FROM teams WHERE event_id = ? AND team_number IN (${team_numbers.map(() => '?').join(',')})`,
    [eventId, ...team_numbers],
  );

  const existingNumbers = new Set(existingTeams.map((t) => t.team_number));
  const notFound = team_numbers.filter((n) => !existingNumbers.has(n));

  if (existingTeams.length === 0) {
    return {
      ok: true,
      updated: 0,
      not_found: notFound.length > 0 ? notFound : undefined,
    };
  }

  await db.transaction(async (tx) => {
    for (const team of existingTeams) {
      await tx.run(
        `UPDATE teams SET status = 'checked_in', checked_in_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [team.id],
      );
    }
  });

  await createAuditEntry(db, {
    event_id: Number(eventId),
    user_id: userId,
    action: 'teams_bulk_checked_in',
    entity_type: 'teams',
    entity_id: null,
    old_value: null,
    new_value: toAuditJson({
      updated_count: existingTeams.length,
      updated_team_ids: existingTeams.map((t) => t.id),
      not_found: notFound.length > 0 ? notFound : undefined,
    }),
    ip_address: ipAddress,
  });

  return {
    ok: true,
    updated: existingTeams.length,
    not_found: notFound.length > 0 ? notFound : undefined,
  };
}
