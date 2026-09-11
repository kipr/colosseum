import { requestJson } from './http';
import type { PublicEvent } from './types';

export function getPublicEvents({
  signal,
}: { signal?: AbortSignal } = {}): Promise<PublicEvent[]> {
  return requestJson<PublicEvent[]>('/events/public', { signal });
}
