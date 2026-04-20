import type { Database } from '../database/connection';

const ALLOWED_SCORE_UPDATE_FIELDS = [
  'score',
  'score_submission_id',
  'scored_at',
];

export interface UpdateSeedingScoreParams {
  db: Database;
  scoreId: number | string;
  body: Record<string, unknown>;
}

export type UpdateSeedingScoreResult =
  | { ok: true; score: Record<string, unknown> }
  | { ok: false; status: 400 | 404; error: string };

/** Apply a partial update to a `seeding_scores` row. */
export async function updateSeedingScore(
  params: UpdateSeedingScoreParams,
): Promise<UpdateSeedingScoreResult> {
  const { db, scoreId, body } = params;

  const updates = Object.entries(body).filter(([key]) =>
    ALLOWED_SCORE_UPDATE_FIELDS.includes(key),
  );

  if (updates.length === 0) {
    return { ok: false, status: 400, error: 'No valid fields to update' };
  }

  const setClause = updates.map(([key]) => `${key} = ?`).join(', ');
  const values = updates.map(([, value]) => value);

  const result = await db.run(
    `UPDATE seeding_scores SET ${setClause} WHERE id = ?`,
    [...values, scoreId],
  );

  if (result.changes === 0) {
    return { ok: false, status: 404, error: 'Seeding score not found' };
  }

  const score = await db.get('SELECT * FROM seeding_scores WHERE id = ?', [
    scoreId,
  ]);
  return { ok: true, score: score ?? {} };
}
