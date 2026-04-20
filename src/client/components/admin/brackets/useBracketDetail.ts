import { useCallback, useEffect, useState } from 'react';
import { apiJson } from '../../../utils/apiClient';
import type {
  BracketDetail,
  BracketEntryWithRank,
} from '../../../types/brackets';

/**
 * Load a single bracket plus its rankings. The parent provides a notFound
 * callback fired when the bracket no longer exists (e.g. the user followed a
 * stale URL).
 */
export function useBracketDetail(
  bracketId: number | null,
  onError: (message: string) => void,
  onNotFound?: () => void,
) {
  const [bracketDetail, setBracketDetail] = useState<BracketDetail | null>(
    null,
  );
  const [rankings, setRankings] = useState<BracketEntryWithRank[] | null>(null);
  const [rankingsWeight, setRankingsWeight] = useState<number>(1);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!bracketId) {
      setBracketDetail(null);
      setRankings(null);
      return;
    }
    setLoading(true);
    try {
      const [detail, rankingsBody] = await Promise.all([
        apiJson<BracketDetail>(`/brackets/${bracketId}`).catch((err) => {
          if ((err as { status?: number }).status === 404 && onNotFound) {
            onNotFound();
          }
          throw err;
        }),
        apiJson<{
          weight: number;
          entries: BracketEntryWithRank[];
        }>(`/brackets/${bracketId}/rankings`).catch(() => null),
      ]);
      if (rankingsBody) {
        detail.rankings = rankingsBody.entries;
        setRankings(rankingsBody.entries);
        setRankingsWeight(rankingsBody.weight);
      } else {
        setRankings(null);
      }
      setBracketDetail(detail);
    } catch (error) {
      if ((error as { status?: number }).status !== 404) {
        console.error('Error fetching bracket detail:', error);
        onError('Failed to load bracket details');
      }
    } finally {
      setLoading(false);
    }
  }, [bracketId, onError, onNotFound]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return {
    bracketDetail,
    setBracketDetail,
    rankings,
    setRankings,
    rankingsWeight,
    loading,
    refetch,
  };
}
