import { useCallback, useState } from 'react';
import { apiJson } from '../../../utils/apiClient';
import type { Bracket, BracketGame } from './queueHelpers';

/**
 * Lazy-loaded brackets and per-bracket games used by the populate / add
 * modals. Callers invoke `loadBrackets()` when opening a modal and
 * `loadGames(bracketId)` after a bracket is chosen.
 */
export function useQueueBrackets(eventId: number | null) {
  const [brackets, setBrackets] = useState<Bracket[]>([]);
  const [bracketGames, setBracketGames] = useState<BracketGame[]>([]);

  const loadBrackets = useCallback(async () => {
    if (!eventId) return;
    try {
      const data = await apiJson<Bracket[]>(`/brackets/event/${eventId}`);
      setBrackets(data);
      return data;
    } catch (error) {
      console.error('Error fetching brackets:', error);
    }
  }, [eventId]);

  const loadGames = useCallback(async (bracketId: number) => {
    try {
      const data = await apiJson<BracketGame[]>(`/brackets/${bracketId}/games`);
      const eligibleGames = data.filter(
        (g) => g.team1_id && g.team2_id && g.status !== 'completed',
      );
      setBracketGames(eligibleGames);
      return eligibleGames;
    } catch (error) {
      console.error('Error fetching bracket games:', error);
      setBracketGames([]);
      return [];
    }
  }, []);

  return { brackets, bracketGames, setBracketGames, loadBrackets, loadGames };
}
