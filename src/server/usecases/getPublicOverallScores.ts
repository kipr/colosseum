import {
  computeOverallScores,
  type OverallScoreRow,
} from '../services/overallScores';
import { calculateEventBracketRankingsIfReady } from '../services/bracketRankings';
import { areFinalScoresReleased } from '../utils/eventVisibility';

export interface GetPublicOverallScoresParams {
  eventId: number | string;
}

export type GetPublicOverallScoresResult =
  | { ok: true; rows: OverallScoreRow[] }
  | { ok: false; status: 404; error: string };

/**
 * Public overall scores: only returned when the admin has flipped
 * `spectator_results_released` on a `complete` event. Otherwise returns 404
 * to avoid leaking event existence/state.
 */
export async function getPublicOverallScores(
  params: GetPublicOverallScoresParams,
): Promise<GetPublicOverallScoresResult> {
  const { eventId } = params;

  if (!(await areFinalScoresReleased(eventId))) {
    return { ok: false, status: 404, error: 'Not found' };
  }

  const eventIdNum =
    typeof eventId === 'number' ? eventId : parseInt(eventId, 10);
  await calculateEventBracketRankingsIfReady(eventIdNum);
  const rows = await computeOverallScores(eventIdNum);
  return { ok: true, rows };
}
