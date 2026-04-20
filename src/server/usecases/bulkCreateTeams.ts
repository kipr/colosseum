import type { Database } from '../database/connection';
import { createAuditEntry } from '../routes/audit';
import { toAuditJson } from '../utils/auditJson';

export interface BulkCreateTeamsParams {
  db: Database;
  body: Record<string, unknown>;
  userId: number | null;
  ipAddress: string | null;
}

export interface BulkCreateTeamsError {
  index: number;
  error: string;
}

export type BulkCreateTeamsResult =
  | {
      ok: true;
      created: number;
      errors?: BulkCreateTeamsError[];
    }
  | { ok: false; status: 400; error: string };

interface IncomingTeam {
  team_number?: number;
  team_name?: string;
  display_name?: string;
  status?: string;
}

interface ValidatedTeam {
  index: number;
  team_number: number;
  team_name: string;
  display_name: string;
  status: string;
}

function validatePayload(teams: IncomingTeam[]): {
  validTeams: ValidatedTeam[];
  errors: BulkCreateTeamsError[];
} {
  const errors: BulkCreateTeamsError[] = [];
  const validTeams: ValidatedTeam[] = [];
  const seen = new Set<number>();

  teams.forEach((row, i) => {
    const { team_number, team_name, display_name, status } = row;
    if (!team_number || !team_name) {
      errors.push({
        index: i,
        error: 'team_number and team_name are required',
      });
      return;
    }
    if (seen.has(team_number)) {
      errors.push({
        index: i,
        error: `Duplicate team number ${team_number} in payload`,
      });
      return;
    }
    seen.add(team_number);
    validTeams.push({
      index: i,
      team_number,
      team_name,
      display_name: display_name || `${team_number} ${team_name}`,
      status: status || 'registered',
    });
  });

  return { validTeams, errors };
}

/**
 * Bulk-create teams in three phases: payload validation, existence check,
 * transactional insert + audit. Per-row failures are collected as errors
 * rather than aborting the batch.
 */
export async function bulkCreateTeams(
  params: BulkCreateTeamsParams,
): Promise<BulkCreateTeamsResult> {
  const { db, body, userId, ipAddress } = params;

  const event_id = body.event_id as number | undefined;
  const teams = body.teams as IncomingTeam[] | undefined;

  if (!event_id || !Array.isArray(teams) || teams.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'event_id and teams array are required',
    };
  }

  const event = await db.get('SELECT id FROM events WHERE id = ?', [event_id]);
  if (!event) {
    return { ok: false, status: 400, error: 'Event does not exist' };
  }

  const { validTeams, errors } = validatePayload(teams);

  if (validTeams.length === 0) {
    return {
      ok: true,
      created: 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  const existingTeams = await db.all<{ team_number: number }>(
    `SELECT team_number FROM teams WHERE event_id = ? AND team_number IN (${validTeams.map(() => '?').join(',')})`,
    [event_id, ...validTeams.map((t) => t.team_number)],
  );
  const existingNumbers = new Set(existingTeams.map((t) => t.team_number));

  const teamsToInsert = validTeams.filter((t) => {
    if (existingNumbers.has(t.team_number)) {
      errors.push({
        index: t.index,
        error: `Team number ${t.team_number} already exists`,
      });
      return false;
    }
    return true;
  });

  if (teamsToInsert.length === 0) {
    return {
      ok: true,
      created: 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  const createdTeamIds: number[] = [];
  await db.transaction(async (tx) => {
    for (const team of teamsToInsert) {
      const insertResult = await tx.run(
        `INSERT INTO teams (event_id, team_number, team_name, display_name, status)
         VALUES (?, ?, ?, ?, ?)`,
        [
          event_id,
          team.team_number,
          team.team_name,
          team.display_name,
          team.status,
        ],
      );
      if (insertResult.lastID) createdTeamIds.push(insertResult.lastID);
    }
  });

  await createAuditEntry(db, {
    event_id,
    user_id: userId,
    action: 'teams_bulk_added',
    entity_type: 'teams',
    entity_id: null,
    old_value: null,
    new_value: toAuditJson({
      created_count: teamsToInsert.length,
      created_team_ids: createdTeamIds,
      errors: errors.length > 0 ? errors : undefined,
    }),
    ip_address: ipAddress,
  });

  return {
    ok: true,
    created: teamsToInsert.length,
    errors: errors.length > 0 ? errors : undefined,
  };
}
