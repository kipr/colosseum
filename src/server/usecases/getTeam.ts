import type { Database } from '../database/connection';

export interface GetTeamParams {
  db: Database;
  teamId: number | string;
}

export type GetTeamResult =
  | { ok: true; team: Record<string, unknown> }
  | { ok: false; status: 404; error: string };

/** Get a single team by ID. */
export async function getTeam(params: GetTeamParams): Promise<GetTeamResult> {
  const { db, teamId } = params;
  const team = await db.get('SELECT * FROM teams WHERE id = ?', [teamId]);
  if (!team) {
    return { ok: false, status: 404, error: 'Team not found' };
  }
  return { ok: true, team };
}
