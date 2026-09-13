import { requestJson, VERSIONED_GET_CACHE } from './http';

export const QUEUE_STATUSES = [
  'queued',
  'called',
  'arrived',
  'on_table',
  'scored',
] as const;

export type QueueStatus = (typeof QUEUE_STATUSES)[number];
export type QueueType = 'seeding' | 'bracket' | 'double_seeding';

export interface QueueItem {
  id: number;
  event_id: number;
  bracket_game_id: number | null;
  seeding_team_id: number | null;
  seeding_round: number | null;
  double_seeding_match_id: number | null;
  queue_type: QueueType;
  queue_position: number;
  status: QueueStatus;
  table_number: number | null;
  called_at: string | null;
  created_at: string;
  game_number: number | null;
  round_name: string | null;
  bracket_side: string | null;
  bracket_name: string | null;
  team1_id: number | null;
  team2_id: number | null;
  team1_number: number | null;
  team1_name: string | null;
  team1_display: string | null;
  team2_number: number | null;
  team2_name: string | null;
  team2_display: string | null;
  team1_last_played_at: string | null;
  team2_last_played_at: string | null;
  team1_busy: boolean;
  team2_busy: boolean;
  seeding_team_number: number | null;
  seeding_team_name: string | null;
  seeding_team_display: string | null;
  seeding_team_last_played_at: string | null;
  seeding_team_busy: boolean;
  double_seeding_round: number | null;
  double_seeding_match_number: number | null;
  double_seeding_team1_id: number | null;
  double_seeding_team2_id: number | null;
  double_seeding_team1_number: number | null;
  double_seeding_team1_name: string | null;
  double_seeding_team1_display: string | null;
  double_seeding_team2_number: number | null;
  double_seeding_team2_name: string | null;
  double_seeding_team2_display: string | null;
  double_seeding_team1_last_played_at: string | null;
  double_seeding_team2_last_played_at: string | null;
  double_seeding_team1_busy: boolean;
  double_seeding_team2_busy: boolean;
  team1_present: boolean;
  team2_present: boolean;
}

export interface QueueFilters {
  statuses?: QueueStatus[];
  queueType?: QueueType | null;
}

export interface QueuePopulateResult {
  created: number;
  message?: string;
}

export function isCompleteQueueStatusSet(statuses: readonly string[]): boolean {
  return (
    statuses.length === QUEUE_STATUSES.length &&
    QUEUE_STATUSES.every((status) => statuses.includes(status))
  );
}

export function getEventQueue(
  eventId: number,
  filters: QueueFilters = {},
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  if (filters.queueType) params.set('queue_type', filters.queueType);
  if (filters.statuses?.length && !isCompleteQueueStatusSet(filters.statuses)) {
    for (const status of filters.statuses) params.append('status', status);
  }
  const qs = params.toString();
  return requestJson<QueueItem[]>(
    `/queue/event/${eventId}${qs ? `?${qs}` : ''}`,
    { signal, cache: VERSIONED_GET_CACHE },
  );
}

export function populateQueueFromBracket({ eventId }: { eventId: number }) {
  return requestJson<QueuePopulateResult>('/queue/populate-from-bracket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_id: eventId }),
  });
}

export function populateQueueFromSeeding({ eventId }: { eventId: number }) {
  return requestJson<QueuePopulateResult>('/queue/populate-from-seeding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_id: eventId }),
  });
}

export function addQueueItem({
  event_id,
  queue_type,
  seeding_team_id,
  seeding_round,
  bracket_game_id,
}: {
  event_id: number;
  queue_type: QueueType;
  seeding_team_id?: number;
  seeding_round?: number;
  bracket_game_id?: number;
}) {
  return requestJson<QueueItem>('/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_id,
      queue_type,
      seeding_team_id,
      seeding_round,
      bracket_game_id,
    }),
  });
}

export function updateQueueStatus({
  queueItemId,
  status,
}: {
  queueItemId: number;
  status: QueueStatus;
}) {
  return requestJson<QueueItem>(`/queue/${queueItemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

export function callQueueItem({ queueItemId }: { queueItemId: number }) {
  return requestJson<QueueItem>(`/queue/${queueItemId}/call`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export function updateQueuePresence({
  queueItemId,
  teamId,
  present,
}: {
  queueItemId: number;
  teamId: number;
  present: boolean;
}) {
  return requestJson<
    Pick<QueueItem, 'id' | 'status' | 'team1_present' | 'team2_present'>
  >(`/queue/${queueItemId}/presence`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ team_id: teamId, present }),
  });
}
