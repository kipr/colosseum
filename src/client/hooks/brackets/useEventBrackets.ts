import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bracket } from '../../types/brackets';
import { listEventBrackets } from '../../api/brackets';

export function useEventBrackets(
  eventId: number | null,
  options?: { onError?: (message: string) => void },
) {
  const [brackets, setBrackets] = useState<Bracket[]>([]);
  const [loading, setLoading] = useState(false);
  const onErrorRef = useRef(options?.onError);
  onErrorRef.current = options?.onError;

  const refresh = useCallback(async () => {
    if (!eventId) {
      setBrackets([]);
      return;
    }

    setLoading(true);
    try {
      const data = await listEventBrackets(eventId);
      setBrackets(data);
    } catch (error) {
      console.error('Error fetching brackets:', error);
      onErrorRef.current?.('Failed to load brackets');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { brackets, loading, refresh, setBrackets };
}
