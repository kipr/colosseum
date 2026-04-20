import type { TeamStatus } from './teamStatus';

/**
 * Canonical Team DTO matching the `teams` table.
 */
export interface Team {
  id: number;
  event_id: number;
  team_number: number;
  team_name: string;
  display_name: string | null;
  status: TeamStatus;
  checked_in_at: string | null;
  created_at: string;
  updated_at: string;
}
