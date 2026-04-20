import { useCallback, useState } from 'react';
import { apiJson } from '../../../utils/apiClient';
import type { Team } from './queueHelpers';

/** Lazy-load the teams roster for the current event (on modal open). */
export function useEventTeams(eventId: number | null) {
  const [teams, setTeams] = useState<Team[]>([]);

  const loadTeams = useCallback(async () => {
    if (!eventId) return [];
    try {
      const data = await apiJson<Team[]>(`/teams/event/${eventId}`);
      setTeams(data);
      return data;
    } catch (error) {
      console.error('Error fetching teams:', error);
      return [];
    }
  }, [eventId]);

  return { teams, loadTeams };
}
