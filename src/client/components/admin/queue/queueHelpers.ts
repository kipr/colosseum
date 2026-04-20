import type { QueueStatus, QueueType } from '@shared/domain/queue';

export interface QueueItem {
  id: number;
  event_id: number;
  bracket_game_id: number | null;
  seeding_team_id: number | null;
  seeding_round: number | null;
  queue_type: QueueType;
  queue_position: number;
  status: QueueStatus;
  table_number: number | null;
  called_at: string | null;
  created_at: string;
  game_number: number | null;
  round_name: string | null;
  bracket_side: string | null;
  bracket_name: string | null;
  team1_number: number | null;
  team1_name: string | null;
  team1_display: string | null;
  team2_number: number | null;
  team2_name: string | null;
  team2_display: string | null;
  seeding_team_number: number | null;
  seeding_team_name: string | null;
  seeding_team_display: string | null;
}

export interface Bracket {
  id: number;
  name: string;
  bracket_size: number;
  status: string;
}

export interface BracketGame {
  id: number;
  game_number: number;
  round_name: string | null;
  bracket_side: string | null;
  team1_id: number | null;
  team2_id: number | null;
  team1_number: number | null;
  team1_name: string | null;
  team2_number: number | null;
  team2_name: string | null;
  status: string;
}

export interface Team {
  id: number;
  team_number: number;
  team_name: string;
  display_name: string | null;
}

export type SortField = 'gameNumber' | 'teamNumber' | 'teamName';
export type SortDirection = 'asc' | 'desc';

export function getTypeClass(type: QueueType): string {
  return `queue-type-${type}`;
}

export function getRoundOrder(item: QueueItem): number {
  if (item.queue_type === 'seeding' && item.seeding_round !== null) {
    return item.seeding_round;
  }
  if (item.round_name) {
    const match = item.round_name.match(/\d+/);
    if (match) {
      return Number(match[0]);
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

export function getTeamSortValue(item: QueueItem): string {
  if (item.queue_type === 'seeding') {
    return (item.seeding_team_name || '').toLowerCase();
  }
  const team1 = (item.team1_name || '').toLowerCase();
  const team2 = (item.team2_name || '').toLowerCase();
  return `${team1} ${team2}`.trim();
}

export function getTeamNumberSortValue(item: QueueItem): number {
  if (item.queue_type === 'seeding') {
    return item.seeding_team_number ?? Number.MAX_SAFE_INTEGER;
  }
  return Math.min(
    item.team1_number ?? Number.MAX_SAFE_INTEGER,
    item.team2_number ?? Number.MAX_SAFE_INTEGER,
  );
}

export function renderTeamNumber(item: QueueItem): string | number {
  if (item.queue_type === 'seeding') {
    return item.seeding_team_number ?? '-';
  }
  const team1Number = item.team1_number ?? '-';
  const team2Number = item.team2_number ?? '-';
  return `${team1Number} vs ${team2Number}`;
}

/**
 * Sort the queue by round (always primary), then by the chosen field. Equal
 * keys fall back to queue_position for stable ordering.
 */
export function sortQueue(
  items: QueueItem[],
  sortField: SortField,
  sortDirection: SortDirection,
): QueueItem[] {
  const sorted = [...items];
  sorted.sort((a, b) => {
    const roundCompare = getRoundOrder(a) - getRoundOrder(b);
    if (roundCompare !== 0) return roundCompare;

    let valueCompare = 0;
    if (sortField === 'gameNumber') {
      valueCompare = a.queue_position - b.queue_position;
    } else if (sortField === 'teamNumber') {
      valueCompare = getTeamNumberSortValue(a) - getTeamNumberSortValue(b);
    } else {
      valueCompare = getTeamSortValue(a).localeCompare(getTeamSortValue(b));
    }

    if (valueCompare !== 0) {
      return sortDirection === 'asc' ? valueCompare : -valueCompare;
    }

    return a.queue_position - b.queue_position;
  });
  return sorted;
}
