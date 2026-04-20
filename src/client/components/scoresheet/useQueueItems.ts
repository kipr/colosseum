import { useEffect, useState, useCallback } from 'react';

export interface QueueItem {
  id: number;
  queue_type: string;
  seeding_team_id: number;
  seeding_round: number;
  seeding_team_number: number;
  seeding_team_name: string;
  queue_position: number;
  status: string;
}

const QUEUE_STATUSES = ['queued', 'called', 'arrived', 'on_table', 'scored'];

/**
 * Poll the seeding queue every 5s while `enabled` is true. Returns the current
 * list of queue items plus a `reload()` function the caller can invoke after
 * a submission to refresh immediately.
 */
export function useQueueItems(
  eventId: number | undefined,
  enabled: boolean,
): { items: QueueItem[]; reload: () => Promise<void> } {
  const [items, setItems] = useState<QueueItem[]>([]);

  const reload = useCallback(async () => {
    if (!eventId) return;
    try {
      const url = `/queue/event/${eventId}?queue_type=seeding&status=${QUEUE_STATUSES.join(',')}&sync=1`;
      const response = await fetch(url);
      if (!response.ok) return;
      const data = await response.json();
      setItems(data);
    } catch (error) {
      console.error('Error loading queue:', error);
    }
  }, [eventId]);

  useEffect(() => {
    if (!enabled || !eventId) return;
    reload();
    const interval = setInterval(reload, 5000);
    return () => clearInterval(interval);
  }, [enabled, eventId, reload]);

  return { items, reload };
}
