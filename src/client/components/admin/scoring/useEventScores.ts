import { useCallback, useEffect, useRef, useState } from 'react';
import { apiJson } from '../../../utils/apiClient';
import type { EventScoresResponse, ScoreSubmission } from './types';

interface UseEventScoresArgs {
  eventId: number | null;
  page: number;
  limit: number;
  filterStatus: string;
  filterType: string;
  pollIntervalMs?: number;
  onError: (message: string) => void;
}

interface UseEventScoresResult {
  scores: ScoreSubmission[];
  loading: boolean;
  totalCount: number;
  totalPages: number;
  reload: (showLoading?: boolean) => Promise<void>;
}

/**
 * Loads paged event-scoped score submissions and polls for updates.
 * Splitting this from ScoringTab keeps the component free of fetch/polling boilerplate.
 */
export function useEventScores({
  eventId,
  page,
  limit,
  filterStatus,
  filterType,
  pollIntervalMs = 10000,
  onError,
}: UseEventScoresArgs): UseEventScoresResult {
  const [scores, setScores] = useState<ScoreSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const reload = useCallback(
    async (showLoading = true) => {
      if (!eventId) return;
      if (showLoading) setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('limit', String(limit));
        if (filterStatus) params.set('status', filterStatus);
        if (filterType) params.set('score_type', filterType);
        const data = await apiJson<EventScoresResponse>(
          `/scores/by-event/${eventId}?${params.toString()}`,
        );
        setScores(data.rows);
        setTotalPages(data.totalPages);
        setTotalCount(data.totalCount);
      } catch (error) {
        console.error('Error loading event scores:', error);
        onErrorRef.current('Failed to load event scores');
      } finally {
        setLoading(false);
      }
    },
    [eventId, page, limit, filterStatus, filterType],
  );

  useEffect(() => {
    if (!eventId) return;
    reload(true);
    const interval = setInterval(() => {
      reload(false);
    }, pollIntervalMs);
    return () => clearInterval(interval);
  }, [eventId, reload, pollIntervalMs]);

  return { scores, loading, totalPages, totalCount, reload };
}
