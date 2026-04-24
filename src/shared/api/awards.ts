/**
 * Response shapes for the awards routes (`src/server/routes/awards.ts`).
 *
 * This file covers three related families:
 *
 * 1. **Admin award templates** (`AwardTemplate`) — the global catalog of
 *    reusable award definitions. Source: `GET /awards/templates`,
 *    `POST /awards/templates`, `PATCH /awards/templates/:id`. Consumer:
 *    `src/client/components/admin/AwardsTab.tsx`.
 *
 * 2. **Admin event awards** (`EventAwardRecipient`, `EventAward`,
 *    `EventAwardListResponse`, `ApplyAutomaticAwardsResponse`) — the
 *    event-scoped awards seen on the admin Awards tab. Sources:
 *    `GET /awards/event/:eventId` and `POST /awards/event/:eventId/automatic`.
 *    Consumer: `src/client/components/admin/AwardsTab.tsx`.
 *
 * 3. **Public / spectator awards** (`AutomaticAwardsPublic` and the
 *    `MedalPlacement` family, plus `PublicManualAward` /
 *    `PublicEventAwardsResponse`) — the release-gated bundle surfaced by
 *    `GET /awards/event/:eventId/public`. Sources:
 *    `computeAutomaticAwards()` in `src/server/services/automaticAwards.ts`
 *    (for the `automatic` half) and the `GET /awards/event/:eventId/public`
 *    handler (for the `manual` half). Consumers:
 *    `src/client/components/spectator/SpectatorAutomaticAwards.tsx` and
 *    `src/client/pages/Spectator.tsx`.
 *
 * Arrays are `readonly` so decoded responses cannot be mutated in place by
 * either side.
 */

export type MedalKind = 'gold' | 'silver' | 'bronze';

export interface PublicAwardTeam {
  readonly team_number: number;
  readonly team_name: string;
  readonly display_name: string | null;
}

export interface MedalPlacement {
  readonly place: 1 | 2 | 3;
  readonly medal: MedalKind;
  readonly recipients: readonly PublicAwardTeam[];
}

export interface DeBracketAwards {
  readonly bracket_id: number;
  readonly bracket_name: string;
  readonly placements: readonly MedalPlacement[];
}

export interface PerBracketOverallAwards {
  readonly bracket_id: number;
  readonly bracket_name: string;
  readonly placements: readonly MedalPlacement[];
}

export interface EventOverallAwards {
  readonly placements: readonly MedalPlacement[];
}

export interface AutomaticAwardsPublic {
  /** Double-elimination placement medals (ranks 1–3) per bracket that has a champion (rank 1). */
  readonly de: readonly DeBracketAwards[];
  /** Composite overall within each bracket (doc + seed + weighted DE), top three score groups. */
  readonly perBracketOverall: readonly PerBracketOverallAwards[];
  /** Event-wide overall (doc + seed + sum of weighted DE across brackets). */
  readonly eventOverall: EventOverallAwards | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Admin: award templates (global catalog)
// ─────────────────────────────────────────────────────────────────────────

/**
 * One row of `GET /awards/templates`. Also the response body of
 * `POST /awards/templates` and `PATCH /awards/templates/:id`.
 */
export interface AwardTemplate {
  readonly id: number;
  readonly name: string;
  readonly description: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Response body of `GET /awards/templates`. */
export type AwardTemplateListResponse = readonly AwardTemplate[];

// ─────────────────────────────────────────────────────────────────────────
// Admin: event awards (per-event)
// ─────────────────────────────────────────────────────────────────────────

/**
 * One recipient row joined onto an admin event award. Returned inline as
 * an element of `EventAward.recipients` by `GET /awards/event/:eventId`,
 * and as the body of `POST /awards/event-awards/:id/recipients`.
 */
export interface EventAwardRecipient {
  readonly id: number;
  readonly event_award_id: number;
  readonly team_id: number;
  readonly team_number: number;
  readonly team_name: string;
  readonly display_name: string | null;
}

/**
 * One event award (with its recipients) as returned by
 * `GET /awards/event/:eventId`. The mutation endpoints
 * (`POST /awards/event/:eventId`, `PATCH /awards/event-awards/:id`) return
 * the same shape, except that POST always returns an empty `recipients`
 * array and PATCH omits `recipients` entirely (clients re-fetch the full
 * list rather than reading those bodies).
 */
export interface EventAward {
  readonly id: number;
  readonly event_id: number;
  readonly template_award_id: number | null;
  readonly name: string;
  readonly description: string | null;
  readonly sort_order: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly recipients: readonly EventAwardRecipient[];
}

/** Response body of `GET /awards/event/:eventId`. */
export type EventAwardListResponse = readonly EventAward[];

/**
 * Response body of `POST /awards/event/:eventId/automatic`. `created` is
 * the number of new auto-named event awards inserted; `removed` is the
 * number of pre-existing auto-named event awards that were cleared first.
 */
export interface ApplyAutomaticAwardsResponse {
  readonly created: number;
  readonly removed: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Public / spectator: release-gated awards endpoint
// ─────────────────────────────────────────────────────────────────────────

/** One recipient of a manual award in the public bundle. */
export interface PublicManualAwardRecipient {
  readonly team_number: number;
  readonly team_name: string;
  readonly display_name: string | null;
}

/**
 * One manually-defined event award in the public bundle. Auto-named
 * awards (those whose `name` starts with `Auto:`) are filtered out by the
 * server in favour of the structured `automatic` bundle.
 */
export interface PublicManualAward {
  readonly name: string;
  readonly description: string | null;
  readonly sort_order: number;
  readonly recipients: readonly PublicManualAwardRecipient[];
}

/** Response body of `GET /awards/event/:eventId/public`. */
export interface PublicEventAwardsResponse {
  readonly manual: readonly PublicManualAward[];
  readonly automatic: AutomaticAwardsPublic;
}
