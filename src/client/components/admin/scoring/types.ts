/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ScoreSubmission {
  id: number;
  template_name: string;
  participant_name: string;
  match_id: string;
  created_at: string;
  submitted_to_sheet: boolean;
  status: string;
  reviewed_by: number | null;
  reviewed_at: string | null;
  reviewer_name: string | null;
  score_data: any;
  // Event-scoped fields
  event_id?: number;
  score_type?: 'seeding' | 'bracket';
  bracket_game_id?: number;
  seeding_score_id?: number;
  game_queue_id?: number;
  // Joined display fields from by-event endpoint
  submitted_by?: string;
  team_display_number?: string;
  team_name?: string;
  bracket_name?: string;
  game_number?: number;
  queue_position?: number;
  seeding_round?: number;
  // Bracket-specific joined display fields
  bracket_team1_id?: number | null;
  bracket_team2_id?: number | null;
  bracket_team1_score?: number | null;
  bracket_team2_score?: number | null;
  bracket_team1_number?: number | null;
  bracket_team1_name?: string | null;
  bracket_team1_display?: string | null;
  bracket_team2_number?: number | null;
  bracket_team2_name?: string | null;
  bracket_team2_display?: string | null;
  bracket_winner_number?: number | null;
  bracket_winner_name?: string | null;
  bracket_winner_display?: string | null;
}

export interface EventScoresResponse {
  rows: ScoreSubmission[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

export interface AffectedGame {
  id: number;
  game_number: number;
  round_name: string;
  affectedSlot: 'team1' | 'team2' | 'winner';
}
