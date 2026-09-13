import { requestJson, requestJsonBody, VERSIONED_GET_CACHE } from './http';

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
  team1_id: number | null;
  team2_id: number | null;
  team1_present: boolean;
  team2_present: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
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

export function populateQueueFromBracket(v: { eventId: number }) {
  return requestJsonBody<QueuePopulateResult>(
    '/queue/populate-from-bracket',
    'POST',
    { event_id: v.eventId },
  );
}

export function populateQueueFromSeeding(v: { eventId: number }) {
  return requestJsonBody<QueuePopulateResult>(
    '/queue/populate-from-seeding',
    'POST',
    { event_id: v.eventId },
  );
}

export function addQueueItem(v: {
  event_id: number;
  queue_type: QueueType;
  seeding_team_id?: number;
  seeding_round?: number;
  bracket_game_id?: number;
}) {
  return requestJsonBody<QueueItem>('/queue', 'POST', {
    event_id: v.event_id,
    queue_type: v.queue_type,
    seeding_team_id: v.seeding_team_id,
    seeding_round: v.seeding_round,
    bracket_game_id: v.bracket_game_id,
  });
}

export function updateQueueStatus(v: {
  queueItemId: number;
  status: QueueStatus;
}) {
  return requestJsonBody<QueueItem>(`/queue/${v.queueItemId}`, 'PATCH', {
    status: v.status,
  });
}

export function callQueueItem(v: { queueItemId: number }) {
  return requestJsonBody<QueueItem>(
    `/queue/${v.queueItemId}/call`,
    'PATCH',
    {},
  );
}

export function updateQueuePresence(v: {
  queueItemId: number;
  teamId: number;
  present: boolean;
}) {
  return requestJsonBody<
    Pick<QueueItem, 'id' | 'status' | 'team1_present' | 'team2_present'>
  >(`/queue/${v.queueItemId}/presence`, 'PATCH', {
    team_id: v.teamId,
    present: v.present,
  });
}
