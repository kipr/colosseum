/**
 * Response shapes for the admin event-scoped score-submission endpoints.
 *
 * Source of truth for:
 * - Server: `src/server/routes/scores.ts`, `GET /scores/by-event/:eventId`
 *   — base `score_submissions` row left-joined with template, submitter,
 *   reviewer, queue, bracket-game/teams, and seeding-round/team rows for
 *   display in the admin Scoring tab.
 * - Client: `src/client/components/admin/ScoringTab.tsx` (lists, filters,
 *   bulk accept). Also forwarded to `ScoreViewModal`, which still reads it
 *   loosely but receives the same object.
 *
 * `score_data` is the per-template JSON blob the judge submitted, parsed
 * into `{ field_id: { value, label? } }` form by the server before it goes
 * on the wire (see the `JSON.parse` pass in the route handler). It is
 * intentionally typed as a record of `ScoreDataField` so the client can
 * keep doing `data.team_number?.value` without `any`, while still tolerating
 * unknown field ids.
 */

import type { ScoreSubmissionStatus } from '../domain/scoreSubmission';
import type { QueueType } from '../domain/queue';

/**
 * Primitive types a template field can carry. Templates only emit JSON
 * scalars today (numbers for scores, strings for names/team numbers,
 * booleans for checkboxes); keeping this narrow lets the client read
 * `data.team_number?.value` directly into JSX or string templates without
 * unsafe casts.
 */
export type ScoreFieldValue = string | number | boolean | null;

/**
 * One field inside a submitted score's `score_data` JSON blob. Templates
 * decide which field ids exist (`team_number`, `grand_total`, `winner_id`,
 * etc.); `label` is optional UI text the template attached to the value.
 */
export interface ScoreDataField {
  readonly value: ScoreFieldValue;
  readonly label?: string;
}

export type ScoreData = Readonly<Record<string, ScoreDataField | undefined>>;

/**
 * One row of `GET /scores/by-event/:eventId`. The base columns come from
 * `score_submissions`; the rest are joined display fields and may be `null`
 * (no matching row) or `undefined` (irrelevant for this score's `score_type`,
 * e.g. bracket fields on a seeding row).
 */
export interface EventScoreSubmission {
  readonly id: number;
  readonly template_name: string;
  readonly participant_name: string;
  readonly match_id: string;
  readonly created_at: string;
  readonly submitted_to_sheet: boolean;
  readonly status: ScoreSubmissionStatus;
  readonly reviewed_by: number | null;
  readonly reviewed_at: string | null;
  readonly reviewer_name: string | null;
  readonly score_data: ScoreData;

  readonly event_id?: number;
  readonly score_type?: QueueType;
  readonly bracket_game_id?: number;
  readonly seeding_score_id?: number;
  readonly game_queue_id?: number;

  readonly submitted_by?: string;
  readonly team_display_number?: string;
  readonly team_name?: string;
  readonly bracket_name?: string;
  readonly game_number?: number;
  readonly queue_position?: number;
  readonly seeding_round?: number;

  readonly bracket_team1_id?: number | null;
  readonly bracket_team2_id?: number | null;
  readonly bracket_team1_score?: number | null;
  readonly bracket_team2_score?: number | null;
  readonly bracket_team1_number?: number | null;
  readonly bracket_team1_name?: string | null;
  readonly bracket_team1_display?: string | null;
  readonly bracket_team2_number?: number | null;
  readonly bracket_team2_name?: string | null;
  readonly bracket_team2_display?: string | null;
  readonly bracket_winner_number?: number | null;
  readonly bracket_winner_name?: string | null;
  readonly bracket_winner_display?: string | null;
}

/** Response body of `GET /scores/by-event/:eventId`. */
export interface EventScoresResponse {
  readonly rows: readonly EventScoreSubmission[];
  readonly page: number;
  readonly limit: number;
  readonly totalCount: number;
  readonly totalPages: number;
}
