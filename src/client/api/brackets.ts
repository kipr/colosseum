import type {
  AssignedTeam,
  Bracket,
  BracketDetail,
  BracketGame,
  BracketRankingsResponse,
  CreateBracketBody,
  EventBracketGame,
  GenerateEntriesResult,
  GenerateGamesResult,
  PatchBracketBody,
  TeamAssignmentConflict,
} from '../../shared/brackets';

export class BracketApiError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'BracketApiError';
    this.status = status;
    this.body = body;
  }
}

export function isTeamAssignmentConflictError(
  error: unknown,
): error is BracketApiError & {
  body: { conflicts: TeamAssignmentConflict[] };
} {
  return (
    error instanceof BracketApiError &&
    error.status === 409 &&
    Array.isArray(error.body.conflicts)
  );
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', ...init });
  if (response.status === 204) {
    return undefined as T;
  }
  const body = await parseJson(response);
  if (!response.ok) {
    throw new BracketApiError(
      typeof body.error === 'string' ? body.error : 'Request failed',
      response.status,
      body,
    );
  }
  return body as T;
}

export async function listEventBrackets(eventId: number): Promise<Bracket[]> {
  return request<Bracket[]>(`/brackets/event/${eventId}`);
}

export async function listAssignedTeams(
  eventId: number,
): Promise<AssignedTeam[]> {
  return request<AssignedTeam[]>(`/brackets/event/${eventId}/assigned-teams`);
}

export async function getBracket(bracketId: number): Promise<BracketDetail> {
  return request<BracketDetail>(`/brackets/${bracketId}`);
}

export async function listBracketGames(
  bracketId: number,
): Promise<BracketGame[]> {
  return request<BracketGame[]>(`/brackets/${bracketId}/games`);
}

export async function listEventBracketGames(
  eventId: number,
  options?: { eligible?: 'scoreable' },
): Promise<{ games: EventBracketGame[]; etag: string | null; ok: boolean }> {
  const query = options?.eligible ? `?eligible=${options.eligible}` : '';
  const response = await fetch(`/brackets/event/${eventId}/games${query}`, {
    credentials: 'include',
  });
  const etag = response.headers.get('ETag');
  if (!response.ok) {
    const body = await parseJson(response);
    throw new BracketApiError(
      typeof body.error === 'string' ? body.error : 'Request failed',
      response.status,
      body,
    );
  }
  const games = (await response.json()) as EventBracketGame[];
  return { games, etag, ok: true };
}

export async function getAdminRankings(
  bracketId: number,
): Promise<BracketRankingsResponse> {
  return request<BracketRankingsResponse>(`/brackets/${bracketId}/rankings`);
}

export async function getPublicRankings(
  bracketId: number,
): Promise<BracketRankingsResponse> {
  return request<BracketRankingsResponse>(
    `/brackets/${bracketId}/rankings/public`,
  );
}

export async function calculateRankings(bracketId: number): Promise<void> {
  await request(`/brackets/${bracketId}/rankings/calculate`, {
    method: 'POST',
  });
}

export async function createBracket(body: CreateBracketBody): Promise<Bracket> {
  return request<Bracket>('/brackets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function patchBracket(
  bracketId: number,
  body: PatchBracketBody,
): Promise<Bracket> {
  return request<Bracket>(`/brackets/${bracketId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function deleteBracket(bracketId: number): Promise<void> {
  await request(`/brackets/${bracketId}`, { method: 'DELETE' });
}

export async function generateEntries(
  bracketId: number,
  force = false,
): Promise<GenerateEntriesResult> {
  const query = force ? '?force=true' : '';
  return request<GenerateEntriesResult>(
    `/brackets/${bracketId}/entries/generate${query}`,
    { method: 'POST' },
  );
}

export async function generateGames(
  bracketId: number,
  force = false,
): Promise<GenerateGamesResult> {
  const query = force ? '?force=true' : '';
  return request<GenerateGamesResult>(
    `/brackets/${bracketId}/games/generate${query}`,
    { method: 'POST' },
  );
}
