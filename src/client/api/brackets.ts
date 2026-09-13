import {
  requestJson,
  requestJsonBody,
  requestVoid,
  ApiError,
  VERSIONED_GET_CACHE,
} from './http';
import type {
  Bracket,
  BracketDetail,
  BracketEntryWithRank,
  BracketStatus,
} from '../types/brackets';

export type { Bracket, BracketDetail, BracketEntryWithRank };

export interface AssignedTeam {
  team_id: number;
  team_number: number;
  team_name: string;
  bracket_id: number;
  bracket_name: string;
}

export interface BracketRankingsResponse {
  weight: number;
  entries: BracketEntryWithRank[];
}

export interface CreateBracketInput {
  event_id: number;
  name: string;
  team_ids: number[];
  weight?: number;
}

export interface UpdateBracketInput {
  name?: string;
  bracket_size?: number;
  actual_team_count?: number | null;
  weight?: number;
  status?: BracketStatus;
}

export interface GenerateEntriesResult {
  entriesCreated: number;
  byeCount: number;
}

export interface GenerateGamesResult {
  gamesCreated: number;
}

interface BracketConflict {
  team_name: string;
  bracket_name: string;
}

export function getBrackets(eventId: number, signal?: AbortSignal) {
  return requestJson<Bracket[]>(`/brackets/event/${eventId}`, { signal });
}

export function getBracket(bracketId: number, signal?: AbortSignal) {
  return requestJson<BracketDetail>(`/brackets/${bracketId}`, { signal });
}

export function getBracketRankings(bracketId: number, signal?: AbortSignal) {
  return requestJson<BracketRankingsResponse>(
    `/brackets/${bracketId}/rankings`,
    { signal },
  );
}

export function getPublicBracketRankings(
  bracketId: number,
  signal?: AbortSignal,
) {
  return requestJson<BracketRankingsResponse>(
    `/brackets/${bracketId}/rankings/public`,
    { signal },
  );
}

export function getAssignedTeams(eventId: number, signal?: AbortSignal) {
  return requestJson<AssignedTeam[]>(
    `/brackets/event/${eventId}/assigned-teams`,
    { signal },
  );
}

export interface EventBracketGame {
  id: number;
  bracket_game_id?: number;
  bracket_id: number;
  game_number: number;
  round_name: string | null;
  bracket_side: string | null;
  status: string;
  winner_id: number | null;
  team1_id: number | null;
  team2_id: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export function getEventGames(
  eventId: number,
  options: { complete?: boolean } = {},
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  if (options.complete === false) params.set('eligible', 'scoreable');
  const qs = params.toString();
  return requestJson<EventBracketGame[]>(
    `/brackets/event/${eventId}/games${qs ? `?${qs}` : ''}`,
    { signal, cache: VERSIONED_GET_CACHE },
  );
}

export async function createBracket({
  event_id,
  name,
  team_ids,
  weight,
}: CreateBracketInput) {
  const response = await fetch('/brackets', {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ event_id, name, team_ids, weight }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    conflicts?: BracketConflict[];
  } & Partial<Bracket>;
  if (!response.ok) {
    if (response.status === 409 && body.conflicts?.length) {
      const names = body.conflicts
        .map(
          (conflict) => `${conflict.team_name} (in ${conflict.bracket_name})`,
        )
        .join(', ');
      throw new ApiError(
        `Teams already in another bracket: ${names}. Remove them from selection.`,
        { status: 409 },
      );
    }
    throw new ApiError(body.error || 'Failed to create bracket', {
      status: response.status,
    });
  }
  return body as Bracket;
}

export function updateBracket({
  bracketId,
  data,
}: {
  bracketId: number;
  data: UpdateBracketInput;
}) {
  return requestJsonBody<Bracket>(`/brackets/${bracketId}`, 'PATCH', data);
}

export function deleteBracket({ bracketId }: { bracketId: number }) {
  return requestVoid(`/brackets/${bracketId}`, { method: 'DELETE' });
}

export function generateBracketEntries({
  bracketId,
  force,
}: {
  bracketId: number;
  force?: boolean;
}) {
  return requestJson<GenerateEntriesResult>(
    `/brackets/${bracketId}/entries/generate${force ? '?force=true' : ''}`,
    { method: 'POST' },
  );
}

export function generateBracketGames({
  bracketId,
  force,
}: {
  bracketId: number;
  force?: boolean;
}) {
  return requestJson<GenerateGamesResult>(
    `/brackets/${bracketId}/games/generate${force ? '?force=true' : ''}`,
    { method: 'POST' },
  );
}

export function calculateBracketRankings({ bracketId }: { bracketId: number }) {
  return requestJson<unknown>(`/brackets/${bracketId}/rankings/calculate`, {
    method: 'POST',
  });
}
