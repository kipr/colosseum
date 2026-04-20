import { useCallback, useEffect, useState } from 'react';
import { apiJson } from '../../../utils/apiClient';
import type { DocCategory, DocScore, GlobalCategory, Team } from './types';

interface UseDocumentationScoresResult {
  categories: DocCategory[];
  globalCategories: GlobalCategory[];
  teams: Team[];
  scores: DocScore[];
  loading: boolean;
  refetchAll: () => Promise<void>;
  refetchCategories: () => Promise<void>;
  refetchScores: () => Promise<void>;
}

/**
 * Encapsulates the four parallel fetches that drive the documentation tab:
 * event categories, global categories (catalogue), teams, and saved scores.
 * Refetch functions are exposed individually so callers can refresh just the
 * piece that changed (e.g. only categories after add/edit).
 */
export function useDocumentationScores(
  eventId: number | null,
  onError: (message: string) => void,
): UseDocumentationScoresResult {
  const [categories, setCategories] = useState<DocCategory[]>([]);
  const [globalCategories, setGlobalCategories] = useState<GlobalCategory[]>(
    [],
  );
  const [teams, setTeams] = useState<Team[]>([]);
  const [scores, setScores] = useState<DocScore[]>([]);
  const [loading, setLoading] = useState(false);

  const refetchCategories = useCallback(async () => {
    if (!eventId) {
      setCategories([]);
      return;
    }
    try {
      const data = await apiJson<DocCategory[]>(
        `/documentation-scores/categories/event/${eventId}`,
      );
      setCategories(data);
    } catch (err) {
      console.error(err);
      onError('Failed to load categories');
    }
  }, [eventId, onError]);

  const refetchGlobalCategories = useCallback(async () => {
    try {
      const data = await apiJson<GlobalCategory[]>(
        '/documentation-scores/global-categories',
      );
      setGlobalCategories(data);
    } catch (err) {
      console.error(err);
      onError('Failed to load global categories');
    }
  }, [onError]);

  const refetchTeams = useCallback(async () => {
    if (!eventId) {
      setTeams([]);
      return;
    }
    try {
      const data = await apiJson<Team[]>(`/teams/event/${eventId}`);
      setTeams(data);
    } catch (err) {
      console.error(err);
      onError('Failed to load teams');
    }
  }, [eventId, onError]);

  const refetchScores = useCallback(async () => {
    if (!eventId) {
      setScores([]);
      return;
    }
    try {
      const data = await apiJson<DocScore[]>(
        `/documentation-scores/event/${eventId}`,
      );
      setScores(data);
    } catch (err) {
      console.error(err);
      onError('Failed to load documentation scores');
    }
  }, [eventId, onError]);

  const refetchAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([
        refetchCategories(),
        refetchGlobalCategories(),
        refetchTeams(),
        refetchScores(),
      ]);
    } finally {
      setLoading(false);
    }
  }, [refetchCategories, refetchGlobalCategories, refetchTeams, refetchScores]);

  useEffect(() => {
    refetchAll();
  }, [refetchAll]);

  return {
    categories,
    globalCategories,
    teams,
    scores,
    loading,
    refetchAll,
    refetchCategories,
    refetchScores,
  };
}
