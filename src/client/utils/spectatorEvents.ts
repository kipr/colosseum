import type { Season, SpectatorListing } from './eventStatus';

export interface PublicEvent {
  id: number;
  name: string;
  status: string;
  event_date: string | null;
  location: string | null;
  seeding_rounds: number;
  double_seeding_rounds: number;
  final_scores_available: boolean;
  spectator_listing: SpectatorListing;
  season_id: number | null;
  season_name: string | null;
  season_sort_order: number | null;
}

export interface ArchiveSeason extends Season {
  events: PublicEvent[];
}

export function getSpectatorEvents(
  events: PublicEvent[],
  listing: SpectatorListing,
): PublicEvent[] {
  return events
    .filter(
      (event) =>
        event.spectator_listing === listing && event.status !== 'archived',
    )
    .sort((a, b) => {
      if (a.event_date !== b.event_date) {
        if (a.event_date === null) return 1;
        if (b.event_date === null) return -1;
        return a.event_date < b.event_date ? 1 : -1;
      }
      // Public metadata omits created_at; IDs make equal/absent dates stable
      // even when a refetch returns rows in a different order.
      return b.id - a.id;
    });
}

export function groupArchiveEvents(events: PublicEvent[]): ArchiveSeason[] {
  const seasons = new Map<number, ArchiveSeason>();
  for (const event of getSpectatorEvents(events, 'archive')) {
    if (
      event.season_id === null ||
      event.season_name === null ||
      event.season_sort_order === null
    ) {
      continue;
    }
    let season = seasons.get(event.season_id);
    if (!season) {
      season = {
        id: event.season_id,
        name: event.season_name,
        sort_order: event.season_sort_order,
        events: [],
      };
      seasons.set(season.id, season);
    }
    season.events.push(event);
  }
  return [...seasons.values()].sort(
    (a, b) => b.sort_order - a.sort_order || b.id - a.id,
  );
}
