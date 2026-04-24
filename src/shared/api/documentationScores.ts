/**
 * Response shapes for the documentation-score endpoints.
 *
 * Source of truth for:
 * - Server: `src/server/routes/documentationScores.ts`
 *   - `GET /documentation-scores/global-categories` →
 *     `readonly DocumentationGlobalCategory[]`
 *   - `GET /documentation-scores/categories/event/:eventId` →
 *     `readonly DocumentationCategory[]`
 *   - `GET /documentation-scores/event/:eventId` →
 *     `readonly DocumentationScoreAdmin[]`
 *   - `GET /documentation-scores/event/:eventId/public` →
 *     `PublicDocumentationScores` (`{ categories, scores }` bundle, with
 *     internal IDs/timestamps stripped)
 *   - `GET /documentation-scores/team/:teamId` →
 *     `DocumentationScoreForTeam`
 *   - `PUT /documentation-scores/event/:eventId/team/:teamId` →
 *     `DocumentationScoreAdmin` (the upserted row, re-read with display fields)
 * - Client: `src/client/components/admin/DocumentationTab.tsx`,
 *   `src/client/components/documentation/DocumentationScoresDisplay.tsx`,
 *   `src/client/pages/Spectator.tsx`.
 *
 * The admin and public/spectator views share the same conceptual sub-score
 * row, so `DocumentationSubScore` is one type used by both. Categories and
 * per-team scores split into a `Public…` (read-only display) and a
 * `…Admin` (adds internal ids/timestamps for the editor) variant — the
 * admin variant is modeled as the public one extended with the extra
 * fields, so renames stay in lockstep.
 */

/**
 * One sub-score row in a team's documentation score, enriched with the
 * category's name/ordinal/max/weight from the join. Same shape on the
 * admin and public endpoints — public consumers just don't get the
 * surrounding `id` / timestamps.
 */
export interface DocumentationSubScore {
  readonly category_id: number;
  readonly category_name: string;
  readonly ordinal: number;
  readonly max_score: number;
  readonly weight: number;
  readonly score: number;
}

/**
 * A documentation category as registered globally (across all events).
 * Returned by `GET /documentation-scores/global-categories`.
 */
export interface DocumentationGlobalCategory {
  readonly id: number;
  readonly name: string;
  readonly weight: number;
  readonly max_score: number;
}

/**
 * A documentation category linked to an event (with its display ordinal),
 * as it appears in the spectator/public bundle. The id is the global
 * category id.
 */
export interface PublicDocumentationCategory extends DocumentationGlobalCategory {
  readonly ordinal: number;
}

/**
 * A documentation category linked to an event, returned by the admin
 * `GET /documentation-scores/categories/event/:eventId` and by the
 * create/update endpoints. Adds `event_id` on top of the public shape.
 */
export interface DocumentationCategory extends PublicDocumentationCategory {
  readonly event_id: number;
}

/**
 * One team's documentation score as it appears in the spectator/public
 * bundle: team display fields plus the optional list of sub-scores. No
 * internal ids or timestamps.
 */
export interface PublicDocumentationScore {
  readonly team_id: number;
  readonly team_number: number;
  readonly team_name: string;
  readonly display_name: string | null;
  readonly overall_score: number | null;
  readonly sub_scores?: readonly DocumentationSubScore[];
}

/**
 * One team's documentation score as returned by the admin
 * `GET /documentation-scores/event/:eventId` and the upsert endpoint.
 * Adds the row's primary key, the parent event id, and the last-saved
 * timestamp on top of the public shape.
 */
export interface DocumentationScoreAdmin extends PublicDocumentationScore {
  readonly id: number;
  readonly event_id: number;
  readonly scored_at: string | null;
}

/** Response body of `GET /documentation-scores/event/:eventId/public`. */
export interface PublicDocumentationScores {
  readonly categories: readonly PublicDocumentationCategory[];
  readonly scores: readonly PublicDocumentationScore[];
}

/**
 * Minimal team identity returned alongside a team-scoped documentation
 * score lookup. Mirrors the columns selected by
 * `GET /documentation-scores/team/:teamId`.
 */
export interface DocumentationScoreTeamRef {
  readonly id: number;
  readonly event_id: number;
  readonly team_number: number;
  readonly team_name: string;
  readonly display_name: string | null;
}

/**
 * Bare `documentation_scores` row (no joined display fields), as embedded
 * under `documentation_score` in the team-scoped response.
 */
export interface DocumentationScoreRow {
  readonly id: number;
  readonly event_id: number;
  readonly team_id: number;
  readonly overall_score: number | null;
  readonly scored_by: number | null;
  readonly scored_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Response body of `GET /documentation-scores/team/:teamId`. */
export interface DocumentationScoreForTeam {
  readonly team: DocumentationScoreTeamRef;
  readonly documentation_score: DocumentationScoreRow | null;
  readonly sub_scores: readonly DocumentationSubScore[];
}
