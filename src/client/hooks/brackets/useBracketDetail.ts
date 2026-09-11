import { useCallback, useEffect, useRef, useState } from 'react';
import type { BracketDetail, BracketEntryWithRank } from '../../types/brackets';
import {
  BracketApiError,
  calculateRankings,
  getAdminRankings,
  getBracket,
} from '../../api/brackets';

export function useBracketDetail(
  bracketId: number | null,
  options?: {
    includeRankings?: boolean;
    onNotFound?: () => void;
    onError?: (message: string) => void;
  },
) {
  const [bracketDetail, setBracketDetail] = useState<BracketDetail | null>(
    null,
  );
  const [rankings, setRankings] = useState<BracketEntryWithRank[] | null>(null);
  const [rankingsWeight, setRankingsWeight] = useState(1);
  const [rankingsLoading, setRankingsLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const includeRankings = options?.includeRankings ?? false;
  const onNotFoundRef = useRef(options?.onNotFound);
  const onErrorRef = useRef(options?.onError);
  onNotFoundRef.current = options?.onNotFound;
  onErrorRef.current = options?.onError;

  const refresh = useCallback(
    async (id: number) => {
      setDetailLoading(true);
      try {
        const rankingsPromise = includeRankings
          ? getAdminRankings(id).catch(() => null)
          : Promise.resolve(null);

        const [detail, rankingsBody] = await Promise.all([
          getBracket(id),
          rankingsPromise,
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
        console.error('Error fetching bracket details:', error);
        if (error instanceof BracketApiError && error.status === 404) {
          onNotFoundRef.current?.();
          return;
        }
        onErrorRef.current?.('Failed to load bracket details');
      } finally {
        setDetailLoading(false);
      }
    },
    [includeRankings],
  );

  const refreshRankings = useCallback(async (id: number) => {
    setRankingsLoading(true);
    try {
      await calculateRankings(id);
      const body = await getAdminRankings(id);
      setRankings(body.entries);
      setRankingsWeight(body.weight);
    } catch (error) {
      console.error('Error fetching bracket rankings:', error);
      onErrorRef.current?.('Failed to load rankings');
    } finally {
      setRankingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (bracketId) {
      void refresh(bracketId);
    } else {
      setBracketDetail(null);
      setRankings(null);
    }
  }, [bracketId, refresh]);

  return {
    bracketDetail,
    setBracketDetail,
    detailLoading,
    rankings,
    rankingsWeight,
    rankingsLoading,
    refresh,
    refreshRankings,
  };
}
