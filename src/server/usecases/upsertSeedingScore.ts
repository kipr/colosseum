import type { Database } from '../database/connection';

export interface UpsertSeedingScoreParams {
  db: Database;
  body: Record<string, unknown>;
}

export type UpsertSeedingScoreResult =
  | { ok: true; score: Record<string, unknown> }
  | { ok: false; status: 400; error: string };

/**
 * Insert or replace a seeding score for (team_id, round_number).
 * Translates FK/CHECK violations to 400; other errors propagate to the route.
 */
export async function upsertSeedingScore(
  params: UpsertSeedingScoreParams,
): Promise<UpsertSeedingScoreResult> {
  const { db, body } = params;

  const team_id = body.team_id as number | undefined;
  const round_number = body.round_number as number | undefined;
  const score = body.score as number | undefined;
  const score_submission_id = body.score_submission_id as number | undefined;

  if (!team_id || !round_number) {
    return {
      ok: false,
      status: 400,
      error: 'team_id and round_number are required',
    };
  }

  let result;
  try {
    result = await db.run(
      `INSERT INTO seeding_scores (team_id, round_number, score, score_submission_id, scored_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(team_id, round_number) DO UPDATE SET
         score = excluded.score,
         score_submission_id = excluded.score_submission_id,
         scored_at = CURRENT_TIMESTAMP`,
      [team_id, round_number, score ?? null, score_submission_id ?? null],
    );
  } catch (error) {
    const errMsg = (error as Error).message || '';
    if (errMsg.includes('FOREIGN KEY constraint failed')) {
      return { ok: false, status: 400, error: 'Team does not exist' };
    }
    if (errMsg.includes('CHECK constraint failed')) {
      return {
        ok: false,
        status: 400,
        error: 'Invalid round_number (must be > 0)',
      };
    }
    throw error;
  }

  const seedingScore = await db.get(
    'SELECT * FROM seeding_scores WHERE team_id = ? AND round_number = ?',
    [team_id, round_number],
  );

  return { ok: true, score: seedingScore ?? { id: result.lastID } };
}
