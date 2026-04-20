import { useEffect, useState } from 'react';
import { apiJson } from '../../../utils/apiClient';
import type {
  AssignedTeam,
  CreateModalRanking,
  CreateModalScore,
  CreateModalTeam,
} from './types';

interface UseCreateBracketDataResult {
  teams: CreateModalTeam[];
  scores: CreateModalScore[];
  rankings: CreateModalRanking[];
  assigned: AssignedTeam[];
  loading: boolean;
}

/**
 * Lazy loader for the create-bracket modal: pulls teams, seeding scores,
 * seeding rankings, and the cross-bracket assignment map in parallel.
 */
export function useCreateBracketData(
  enabled: boolean,
  eventId: number | null,
  onError: (message: string) => void,
): UseCreateBracketDataResult {
  const [teams, setTeams] = useState<CreateModalTeam[]>([]);
  const [scores, setScores] = useState<CreateModalScore[]>([]);
  const [rankings, setRankings] = useState<CreateModalRanking[]>([]);
  const [assigned, setAssigned] = useState<AssignedTeam[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !eventId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiJson<CreateModalTeam[]>(`/teams/event/${eventId}`),
      apiJson<CreateModalScore[]>(`/seeding/scores/event/${eventId}`),
      apiJson<CreateModalRanking[]>(`/seeding/rankings/event/${eventId}`),
      apiJson<AssignedTeam[]>(`/brackets/event/${eventId}/assigned-teams`),
    ])
      .then(([teamsRes, scoresRes, rankingsRes, assignedRes]) => {
        if (cancelled) return;
        setTeams(teamsRes);
        setScores(scoresRes);
        setRankings(rankingsRes);
        setAssigned(assignedRes);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Error loading create modal data:', err);
        onError(err instanceof Error ? err.message : 'Failed to load teams');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, eventId, onError]);

  return { teams, scores, rankings, assigned, loading };
}
