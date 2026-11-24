import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../utils/api';
import type { Season } from '../utils/eventStatus';

function mergeSeasons(seasons: Season[], saved: Iterable<Season>) {
  const merged = new Map(seasons.map((season) => [season.id, season]));
  for (const season of saved) merged.set(season.id, season);
  return [...merged.values()].sort(
    (a, b) => b.sort_order - a.sort_order || b.id - a.id,
  );
}

export function useSeasons() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const savedSeasons = useRef(new Map<number, Season>());

  const reload = useCallback(async () => {
    const generation = ++request.current;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<Season[]>('/events/seasons', {
        signal: nextController.signal,
        fallbackError: 'Could not load seasons',
      });
      if (generation === request.current) {
        setSeasons(mergeSeasons(data, savedSeasons.current.values()));
      }
    } catch (err) {
      if (generation === request.current) {
        setError(err instanceof Error ? err.message : 'Could not load seasons');
      }
    } finally {
      if (generation === request.current) setLoading(false);
    }
  }, []);

  const addSeason = useCallback((season: Season) => {
    // Reads may predate creation; retain saved options without hiding load errors.
    savedSeasons.current.set(season.id, season);
    setSeasons((current) => mergeSeasons(current, [season]));
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      ++request.current;
      controller.current?.abort();
    };
  }, [reload]);

  return { seasons, loading, error, reload, addSeason };
}

export type SeasonCatalog = ReturnType<typeof useSeasons>;
