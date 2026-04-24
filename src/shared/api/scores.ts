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
 * `score_submissions`; the rest are joined display fields. LEFT-JOINed
 * fields are `null` when there is no matching row (e.g. bracket join fields
 * on a seeding submission, or vice versa). The server normalises every
 * LEFT-JOIN miss to `null` (never `undefined`) so the client only has to
 * branch on a single absent value.
 */
export interface EventScoreSubmission {
  readonly id: number;
  readonly template_id: number;
  readonly template_name: string | null;
  readonly participant_name: string | null;
  readonly match_id: string | null;
  readonly created_at: string;
  readonly submitted_to_sheet: boolean;
  readonly status: ScoreSubmissionStatus;
  readonly reviewed_by: number | null;
  readonly reviewed_at: string | null;
  readonly reviewer_name: string | null;
  readonly score_data: ScoreData;

  readonly event_id: number | null;
  readonly score_type: QueueType | null;
  readonly bracket_game_id: number | null;
  readonly seeding_score_id: number | null;
  readonly game_queue_id: number | null;

  readonly submitted_by: string | null;
  readonly team_display_number: number | null;
  readonly team_name: string | null;
  readonly bracket_name: string | null;
  readonly game_number: number | null;
  readonly queue_position: number | null;
  readonly seeding_round: number | null;

  readonly bracket_team1_id: number | null;
  readonly bracket_team2_id: number | null;
  readonly bracket_team1_score: number | null;
  readonly bracket_team2_score: number | null;
  readonly bracket_team1_number: number | null;
  readonly bracket_team1_name: string | null;
  readonly bracket_team1_display: string | null;
  readonly bracket_team2_number: number | null;
  readonly bracket_team2_name: string | null;
  readonly bracket_team2_display: string | null;
  readonly bracket_winner_number: number | null;
  readonly bracket_winner_name: string | null;
  readonly bracket_winner_display: string | null;
}

/** Response body of `GET /scores/by-event/:eventId`. */
export interface EventScoresResponse {
  readonly rows: readonly EventScoreSubmission[];
  readonly page: number;
  readonly limit: number;
  readonly totalCount: number;
  readonly totalPages: number;
}
