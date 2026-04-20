import { useCallback, useEffect, useState } from 'react';
import { apiJson } from '../../../utils/apiClient';
import type { Bracket } from '../../../types/brackets';

/** Load the brackets list for an event. */
export function useBracketsList(
  eventId: number | null,
  onError: (message: string) => void,
) {
  const [brackets, setBrackets] = useState<Bracket[]>([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!eventId) {
      setBrackets([]);
      return;
    }
    setLoading(true);
    try {
      const data = await apiJson<Bracket[]>(`/brackets/event/${eventId}`);
      setBrackets(data);
    } catch (error) {
      console.error('Error fetching brackets:', error);
      onError('Failed to load brackets');
    } finally {
      setLoading(false);
    }
  }, [eventId, onError]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { brackets, loading, refetch };
}
