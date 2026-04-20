import type { Database } from '../database/connection';
import {
  computeOverallScores,
  type OverallScoreRow,
} from '../services/overallScores';
import { calculateEventBracketRankingsIfReady } from '../services/bracketRankings';

export interface GetOverallScoresParams {
  db: Database;
  eventId: number | string;
}

export type GetOverallScoresResult =
  | { ok: true; rows: OverallScoreRow[] }
  | { ok: false; status: 404; error: string };

/**
 * Admin overall scores: ensures bracket rankings are up to date, then
 * returns the computed overall score rows. Returns 404 when the event
 * doesn't exist.
 */
export async function getOverallScores(
  params: GetOverallScoresParams,
): Promise<GetOverallScoresResult> {
  const { db, eventId } = params;

  const eventIdNum =
    typeof eventId === 'number' ? eventId : parseInt(eventId, 10);
  const event = await db.get('SELECT id FROM events WHERE id = ?', [
    eventIdNum,
  ]);
  if (!event) {
    return { ok: false, status: 404, error: 'Event not found' };
  }

  await calculateEventBracketRankingsIfReady(eventIdNum);
  const rows = await computeOverallScores(eventIdNum);
  return { ok: true, rows };
}
