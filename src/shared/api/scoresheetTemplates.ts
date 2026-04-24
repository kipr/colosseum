/**
 * Response shapes for the scoresheet-template endpoints.
 *
 * Source of truth for:
 * - Server: `src/server/routes/scoresheet.ts`
 *   - `GET /scoresheet/templates` — public list for judges. One row per
 *     template (deduplicated to the most recent linked event), joined to
 *     the event for grouping/labelling. Returns
 *     {@link ScoresheetTemplateForJudges}.
 *   - `GET /scoresheet/templates/admin` (optional `?eventId=`) — admin
 *     list. Includes `access_code` and `is_active`, but no schema or
 *     event metadata. Returns {@link ScoresheetTemplateAdminListItem}.
 *   - `GET /scoresheet/templates/:id` — full template row with parsed
 *     `schema`. Returns {@link ScoresheetTemplateDetail}.
 *   - `POST /scoresheet/templates`, `PUT /scoresheet/templates/:id`
 *     also return {@link ScoresheetTemplateDetail}.
 * - Client: `src/client/pages/Judge.tsx` (judge picker),
 *   `src/client/components/admin/TemplatesTab.tsx` (admin list), and
 *   `src/client/components/admin/TemplateEditorModal.tsx`
 *   (admin create/edit).
 *
 * The `schema` field is a free-form scoresheet definition (fields,
 * layout, bracket source, optional `gameAreasImage`, etc.). It is
 * intentionally typed as a read-only object map here rather than a
 * strict shape — the schema format is owned by the scoresheet renderer
 * and is not yet captured in `shared/domain/`.
 */

import type { EventStatus } from '../domain/event';

/** Free-form scoresheet schema as it crosses the wire (parsed JSON). */
export type ScoresheetSchema = Readonly<Record<string, unknown>>;

/**
 * Columns returned by every scoresheet-template endpoint, regardless of
 * audience. Concrete response shapes extend this with the audience-
 * specific extras (access code, schema, event metadata, ...).
 */
interface ScoresheetTemplateBase {
  readonly id: number;
  readonly name: string;
  readonly description: string | null;
  readonly created_at: string;

  readonly spreadsheet_config_id: number | null;
  readonly spreadsheet_name: string | null;
  readonly sheet_name: string | null;
}

/**
 * One row of `GET /scoresheet/templates/admin`.
 *
 * Carries the admin-only `access_code` and `is_active` flag, but never
 * the schema or event-grouping metadata (those are unused by the admin
 * list and are fetched separately on demand).
 */
export interface ScoresheetTemplateAdminListItem extends ScoresheetTemplateBase {
  readonly access_code: string | null;
  readonly is_active: boolean;
}

/** Response body of `GET /scoresheet/templates/admin`. */
export type ScoresheetTemplateAdminListResponse =
  readonly ScoresheetTemplateAdminListItem[];

/**
 * One row of the public `GET /scoresheet/templates` endpoint used by
 * the judge picker.
 *
 * The server deduplicates to a single row per template by picking the
 * most recent linked event (by `event_date`, then name), so the joined
 * `event_*` columns are always populated — every visible template is
 * attached to a `setup` or `active` event. The schema is included so
 * judges can see field hints without an extra round-trip.
 */
export interface ScoresheetTemplateForJudges extends ScoresheetTemplateBase {
  readonly schema: ScoresheetSchema | null;

  readonly event_id: number;
  readonly event_name: string;
  readonly event_date: string | null;
  readonly event_status: EventStatus;
}

/** Response body of `GET /scoresheet/templates`. */
export type ScoresheetTemplateForJudgesResponse =
  readonly ScoresheetTemplateForJudges[];

/**
 * Response body of `GET /scoresheet/templates/:id`,
 * `POST /scoresheet/templates`, and `PUT /scoresheet/templates/:id` —
 * the full admin-facing template row with parsed schema.
 */
export interface ScoresheetTemplateDetail extends ScoresheetTemplateBase {
  readonly access_code: string | null;
  readonly is_active: boolean;
  readonly schema: ScoresheetSchema | null;
}
