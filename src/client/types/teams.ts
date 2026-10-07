// Team types shared across components

export type TeamStatus = 'registered' | 'checked_in' | 'no_show' | 'withdrawn';

/** Full `teams` row as returned by the admin team endpoints. */
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

/** The identifying fields most lists and lookups need. */
export type TeamSummary = Pick<
  Team,
  'id' | 'team_number' | 'team_name' | 'display_name'
>;
