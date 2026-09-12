import { requestJson } from './http';

export interface SeedingScore {
  id: number;
  team_id: number;
  round_number: number;
  score: number | null;
  team_number: number;
  team_name: string;
  display_name: string | null;
}

export interface SeedingRanking {
  id: number;
  team_id: number;
  seed_average: number | null;
  seed_rank: number | null;
  raw_seed_score: number | null;
  tiebreaker_value: number | null;
  team_number: number;
  team_name: string;
  display_name: string | null;
}

export function getSeedingScores(eventId: number, signal?: AbortSignal) {
  return requestJson<SeedingScore[]>(`/seeding/scores/event/${eventId}`, {
    signal,
  });
}

export function getSeedingRankings(eventId: number, signal?: AbortSignal) {
  return requestJson<SeedingRanking[]>(`/seeding/rankings/event/${eventId}`, {
    signal,
  });
}
