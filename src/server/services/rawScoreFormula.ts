/**
 * Shared helpers for the raw seeding / raw double-seeding score formulas.
 *
 * V2 (new events): scoreComponent divides the team's average by the event's
 * highest single-round score, so consistency is rewarded.
 * Legacy (events created before the cutoff): divide by the max team average,
 * preserving already-published scores bit-for-bit.
 */

import { getDatabase } from '../database/connection';

/**
 * Events with created_at strictly before this timestamp keep the legacy
 * (avg / maxAverage) denominator. Space-separated so the same string works for
 * SQLite text comparison and Postgres timestamp coercion.
 */
export const RAW_SCORE_FORMULA_V2_CUTOFF = '2026-07-27 00:00:00';

/**
 * Returns true when the event should use the legacy raw-score formula
 * (denominator = max team average). Null created_at is treated as legacy so
 * we never silently rewrite published numbers.
 */
export async function usesLegacyRawScoreFormula(
  eventId: number,
): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.get<{ legacy: number | string }>(
    `SELECT COUNT(*) AS legacy FROM events
     WHERE id = ? AND (created_at IS NULL OR created_at < ?)`,
    [eventId, RAW_SCORE_FORMULA_V2_CUTOFF],
  );
  return Number(row?.legacy ?? 0) > 0;
}
