import { useEffect, useState, useCallback } from 'react';
import type { BracketGameOption } from '../scoresheetUtils';
import type { ScoresheetSchema } from '../../../shared/domain/scoresheetSchema';
import { mapDbGame } from './scoresheetData';

/**
 * Load the list of bracket games for the current scoresheet, polling every 5s
 * while head-to-head mode is active. Resolves between event-scoped and
 * single-bracket fetches based on `schema.bracketSource`.
 */
export function useBracketGames(
  schema: ScoresheetSchema,
  isEventScopedBracket: boolean,
  bracketSourceEventId: number | null | undefined,
  enabled: boolean,
): { games: BracketGameOption[]; reload: () => Promise<void> } {
  const [games, setGames] = useState<BracketGameOption[]>([]);

  const reload = useCallback(async () => {
    try {
      const bracketSource = schema.bracketSource;
      if (!bracketSource) return;

      if (
        bracketSource.type === 'db' &&
        isEventScopedBracket &&
        bracketSourceEventId
      ) {
        const response = await fetch(
          `/brackets/event/${bracketSourceEventId}/games?eligible=scoreable`,
          { credentials: 'include' },
        );
        if (!response.ok) {
          const errorData = await response.json();
          console.error('Failed to load bracket games from DB:', errorData);
          return;
        }
        const dbGames = await response.json();
        setGames(dbGames.map((g: Record<string, unknown>) => mapDbGame(g)));
      } else if (bracketSource.type === 'db' && bracketSource.bracketId) {
        const response = await fetch(
          `/brackets/${bracketSource.bracketId}/games`,
          { credentials: 'include' },
        );
        if (!response.ok) {
          const errorData = await response.json();
          console.error('Failed to load bracket games from DB:', errorData);
          return;
        }
        const dbGames = await response.json();
        setGames(
          dbGames.map((g: Record<string, unknown>) =>
            mapDbGame(g, bracketSource.bracketId ?? undefined),
          ),
        );
      } else {
        setGames([]);
      }
    } catch (error) {
      console.error('Error loading bracket games:', error);
    }
  }, [schema.bracketSource, isEventScopedBracket, bracketSourceEventId]);

  useEffect(() => {
    if (!enabled) return;
    reload();
    const interval = setInterval(reload, 5000);
    return () => clearInterval(interval);
  }, [enabled, reload]);

  return { games, reload };
}
