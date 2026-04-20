import { useCallback, useState } from 'react';
import { apiJson, apiSend } from '../../../utils/apiClient';
import type { BracketEntryWithRank } from '../../../types/brackets';

/**
 * Recalculate-and-fetch helper used by the "Refresh rankings" button.
 * Splitting this from useBracketDetail keeps the loading state local to
 * the rankings panel.
 */
export function useBracketRankings(onError: (message: string) => void) {
  const [rankings, setRankings] = useState<BracketEntryWithRank[] | null>(null);
  const [rankingsWeight, setRankingsWeight] = useState<number>(1);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(
    async (bracketId: number) => {
      setLoading(true);
      try {
        await apiSend('POST', `/brackets/${bracketId}/rankings/calculate`);
        const body = await apiJson<{
          weight: number;
          entries: BracketEntryWithRank[];
        }>(`/brackets/${bracketId}/rankings`);
        setRankings(body.entries);
        setRankingsWeight(body.weight);
      } catch (error) {
        console.error('Error fetching bracket rankings:', error);
        onError('Failed to load rankings');
      } finally {
        setLoading(false);
      }
    },
    [onError],
  );

  return { rankings, rankingsWeight, loading, refresh, setRankings };
}
