import type { Database } from '../database/connection';
import { recalculateSeedingRankings as recalculateService } from '../services/seedingRankings';
import { fetchSeedingRankings } from './listSeedingRankings';

export interface RecalculateSeedingRankingsParams {
  db: Database;
  eventId: number | string;
}

export type RecalculateSeedingRankingsResult =
  | {
      ok: true;
      rankings: Record<string, unknown>[];
      teamsRanked: number;
      teamsUnranked: number;
    }
  | { ok: false; status: 404; error: string };

/**
 * Recalculate seeding rankings via the shared service and return the
 * updated rows. Returns 404 when the event has no teams.
 */
export async function recalculateSeedingRankings(
  params: RecalculateSeedingRankingsParams,
): Promise<RecalculateSeedingRankingsResult> {
  const { db, eventId } = params;

  const eventIdNum =
    typeof eventId === 'number' ? eventId : parseInt(eventId, 10);
  const result = await recalculateService(eventIdNum);

  if (result.teamsRanked === 0 && result.teamsUnranked === 0) {
    return { ok: false, status: 404, error: 'No teams found for this event' };
  }

  const rankings = await fetchSeedingRankings(db, eventId);
  return {
    ok: true,
    rankings,
    teamsRanked: result.teamsRanked,
    teamsUnranked: result.teamsUnranked,
  };
}
