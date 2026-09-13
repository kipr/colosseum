import { requestJson, requestJsonBody } from './http';

export interface DoubleSeedingScore {
  id: number;
  event_id: number;
  match_id: number;
  team_id: number;
  round_number: number;
  side: 'team1' | 'team2';
  score: number | null;
  match_number: number | null;
  team_number: number;
  team_name: string;
  display_name: string | null;
}

export interface DoubleSeedingRanking {
  id: number;
  team_id: number;
  seed_average: number | null;
  seed_rank: number | null;
  raw_double_seed_score: number | null;
  tiebreaker_value: number | null;
  team_number: number;
  team_name: string;
  display_name: string | null;
}

export interface DoubleSeedingMatch {
  id: number;
  event_id: number;
  round_number: number;
  match_number: number | null;
  team1_id: number | null;
  team2_id: number | null;
  status: string;
  team1_number: number | null;
  team1_name: string | null;
  team1_display: string | null;
  team2_number: number | null;
  team2_name: string | null;
  team2_display: string | null;
}

export interface GenerateDoubleSeedingResult {
  message?: string;
  rounds: number;
  matchesCreated: number;
  deleted?: number;
  matches: DoubleSeedingMatch[];
}

export interface DeleteDoubleSeedingRoundResult {
  success: boolean;
  round: number;
  deleted: number;
  remainingRounds: number;
}

export interface RecalculateDoubleSeedingResult {
  teamsRanked: number;
  teamsUnranked: number;
}

export function getDoubleSeedingScores(eventId: number, signal?: AbortSignal) {
  return requestJson<DoubleSeedingScore[]>(
    `/double-seeding/scores/event/${eventId}`,
    { signal },
  );
}

export function getDoubleSeedingRankings(
  eventId: number,
  signal?: AbortSignal,
) {
  return requestJson<DoubleSeedingRanking[]>(
    `/double-seeding/rankings/event/${eventId}`,
    { signal },
  );
}

export function getDoubleSeedingMatches(eventId: number, signal?: AbortSignal) {
  return requestJson<DoubleSeedingMatch[]>(
    `/double-seeding/matches/event/${eventId}`,
    { signal },
  );
}

export function generateDoubleSeedingMatches({
  eventId,
  rounds,
}: {
  eventId: number;
  rounds: number;
}) {
  return requestJsonBody<GenerateDoubleSeedingResult>(
    `/double-seeding/matches/generate/${eventId}`,
    'POST',
    { rounds },
  );
}

export function deleteDoubleSeedingRound({
  eventId,
  round,
}: {
  eventId: number;
  round: number;
}) {
  return requestJson<DeleteDoubleSeedingRoundResult>(
    `/double-seeding/matches/event/${eventId}/round/${round}`,
    { method: 'DELETE' },
  );
}

export function recalculateDoubleSeedingRankings({
  eventId,
}: {
  eventId: number;
}) {
  return requestJson<RecalculateDoubleSeedingResult>(
    `/double-seeding/rankings/recalculate/${eventId}`,
    { method: 'POST' },
  );
}
