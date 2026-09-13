import { requestJson } from './http';

export interface AuditLogEntry {
  id: number;
  event_id: number | null;
  user_id: number | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
}

export function getAuditLogs(
  eventId: number,
  params: {
    limit: number;
    offset: number;
    action?: string;
    entityType?: string;
  },
  signal?: AbortSignal,
) {
  const search = new URLSearchParams();
  search.set('limit', String(params.limit));
  search.set('offset', String(params.offset));
  if (params.action) search.set('action', params.action);
  if (params.entityType) search.set('entity_type', params.entityType);
  return requestJson<AuditLogEntry[]>(
    `/audit/event/${eventId}?${search.toString()}`,
    { signal },
  );
}

export function getEntityHistory(
  entityType: string,
  entityId: number,
  limit = 50,
  signal?: AbortSignal,
) {
  return requestJson<AuditLogEntry[]>(
    `/audit/entity/${encodeURIComponent(entityType)}/${entityId}?limit=${limit}`,
    { signal },
  );
}
