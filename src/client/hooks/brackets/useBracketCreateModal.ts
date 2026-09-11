import { useEffect, useRef, useState } from 'react';
import { listAssignedTeams } from '../../api/brackets';
import type { AssignedTeam } from '../../types/brackets';

export interface CreateModalTeam {
  id: number;
  team_number: number;
  team_name: string;
  display_name: string | null;
}

export interface CreateModalRanking {
  team_id: number;
  seed_average: number | null;
  seed_rank: number | null;
}

export interface CreateModalDoubleSeedingRanking {
  team_id: number;
  seed_average: number | null;
  seed_rank: number | null;
}

export function useBracketCreateModal(
  eventId: number | null,
  options: {
    open: boolean;
    doubleSeedingEnabled: boolean;
    onError?: (message: string) => void;
  },
) {
  const [createTeams, setCreateTeams] = useState<CreateModalTeam[]>([]);
  const [createRankings, setCreateRankings] = useState<CreateModalRanking[]>(
    [],
  );
  const [createDoubleSeedingRankings, setCreateDoubleSeedingRankings] =
    useState<CreateModalDoubleSeedingRanking[]>([]);
  const [createAssigned, setCreateAssigned] = useState<AssignedTeam[]>([]);
  const [createDataLoading, setCreateDataLoading] = useState(false);
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<number>>(
    new Set(),
  );
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;

  useEffect(() => {
    if (!options.open || !eventId) {
      return;
    }
    let cancelled = false;
    setCreateDataLoading(true);
    setSelectedTeamIds(new Set());
    Promise.all([
      fetch(`/teams/event/${eventId}`, { credentials: 'include' }),
      fetch(`/seeding/rankings/event/${eventId}`, {
        credentials: 'include',
      }),
      options.doubleSeedingEnabled
        ? fetch(`/double-seeding/rankings/event/${eventId}`, {
            credentials: 'include',
          })
        : Promise.resolve(null),
      listAssignedTeams(eventId),
    ])
      .then(async ([teamsRes, rankingsRes, dsRankingsRes, assigned]) => {
        if (cancelled) return;
        if (!teamsRes.ok) throw new Error('Failed to fetch teams');
        if (!rankingsRes.ok) throw new Error('Failed to fetch rankings');
        if (dsRankingsRes && !dsRankingsRes.ok)
          throw new Error('Failed to fetch double-seeding rankings');
        const [teams, rankings, dsRankings] = await Promise.all([
          teamsRes.json(),
          rankingsRes.json(),
          dsRankingsRes?.json() ?? [],
        ]);
        if (cancelled) return;
        setCreateTeams(teams);
        setCreateRankings(rankings);
        setCreateDoubleSeedingRankings(dsRankings);
        setCreateAssigned(assigned);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Error loading create modal data:', err);
          onErrorRef.current?.(
            err instanceof Error ? err.message : 'Failed to load teams',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setCreateDataLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [options.open, eventId, options.doubleSeedingEnabled]);

  return {
    createTeams,
    createRankings,
    createDoubleSeedingRankings,
    createAssigned,
    createDataLoading,
    selectedTeamIds,
    setSelectedTeamIds,
  };
}
