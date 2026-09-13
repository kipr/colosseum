import { requestJson, requestJsonBody, requestVoid } from './http';

export type TeamStatus = 'registered' | 'checked_in' | 'no_show' | 'withdrawn';
export interface Team {
  id: number;
  event_id: number;
  team_number: number;
  team_name: string;
  display_name: string | null;
  status: TeamStatus;
  checked_in_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface TeamInput {
  team_number: number;
  team_name: string;
  display_name?: string;
  status?: TeamStatus;
}
export interface BulkImportResult {
  created: number;
  errors?: { index: number; error: string }[];
}
export function getTeams(
  eventId: number,
  status: TeamStatus | 'all',
  signal?: AbortSignal,
) {
  const filter = status === 'all' ? '' : `?status=${status}`;
  return requestJson<Team[]>(`/teams/event/${eventId}${filter}`, { signal });
}
export function saveTeam({
  eventId,
  teamId,
  data,
}: {
  eventId: number;
  teamId?: number;
  data: TeamInput;
}) {
  return requestJsonBody<Team>(
    teamId ? `/teams/${teamId}` : '/teams',
    teamId ? 'PATCH' : 'POST',
    teamId ? data : { ...data, event_id: eventId },
  );
}
export function deleteTeam({ teamId }: { teamId: number }) {
  return requestVoid(`/teams/${teamId}`, { method: 'DELETE' });
}
export function checkInTeam({ teamId }: { teamId: number }) {
  return requestJson<Team>(`/teams/${teamId}/check-in`, { method: 'PATCH' });
}
export function importTeams({
  eventId,
  teams,
}: {
  eventId: number;
  teams: TeamInput[];
}) {
  return requestJsonBody<BulkImportResult>('/teams/bulk', 'POST', {
    event_id: eventId,
    teams,
  });
}
export function checkInTeams({
  eventId,
  teamNumbers,
}: {
  eventId: number;
  teamNumbers: number[];
}) {
  return requestJsonBody<{ updated: number; not_found?: number[] }>(
    `/teams/event/${eventId}/check-in/bulk`,
    'PATCH',
    { team_numbers: teamNumbers },
  );
}
