import { useCallback, useEffect, useState } from 'react';
import {
  QUEUE_STATUSES,
  type QueueStatus,
  type QueueType,
} from '@shared/domain/queue';
import { apiJson } from '../../../utils/apiClient';
import type { QueueItem } from './queueHelpers';

interface UseQueueDataResult {
  queue: QueueItem[];
  setQueue: React.Dispatch<React.SetStateAction<QueueItem[]>>;
  loading: boolean;
  refetch: () => Promise<void>;
}

/**
 * Load the event queue with filter support. The hook re-fetches whenever the
 * event id or filters change. Returns `setQueue` so callers can apply
 * optimistic updates after reorder/status changes.
 */
export function useQueueData(
  eventId: number | null,
  filterStatuses: QueueStatus[],
  filterType: QueueType | 'all',
  onError: (message: string) => void,
): UseQueueDataResult {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!eventId) {
      setQueue([]);
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('sync', '1');
      const isAllSelected = filterStatuses.length === QUEUE_STATUSES.length;
      if (!isAllSelected) {
        filterStatuses.forEach((status) => {
          params.append('status', status);
        });
      }
      if (filterType !== 'all') {
        params.append('queue_type', filterType);
      }
      const url = `/queue/event/${eventId}${params.toString() ? `?${params}` : ''}`;
      const data = await apiJson<QueueItem[]>(url);
      setQueue(data);
    } catch (error) {
      console.error('Error fetching queue:', error);
      onError('Failed to load queue');
    } finally {
      setLoading(false);
    }
  }, [eventId, filterStatuses, filterType, onError]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { queue, setQueue, loading, refetch };
}
