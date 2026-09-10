import type { ReactNode } from 'react';

export interface Team {
  id: number;
  team_number: number;
  team_name: string;
  display_name: string | null;
}

export interface SeedingTableRanking {
  seed_rank: number | null;
  seed_average: number | null;
  raw_score: number | null;
}

export interface SeedingTableRow {
  team: Team;
  scores: Map<number, { score: number | null } | null>;
  ranking: SeedingTableRanking | null;
}

export type SeedingTableVariant = 'default' | 'spectator';

export interface SeedingTableColumnCopy {
  full: string;
  short: string;
  title: string;
  sortAriaLabel: string;
}

export interface SeedingTableCopy {
  title: string;
  description: ReactNode;
  rank: SeedingTableColumnCopy;
  average: SeedingTableColumnCopy;
  raw: SeedingTableColumnCopy;
}
