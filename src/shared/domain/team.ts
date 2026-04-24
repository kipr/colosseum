/**
 * Canonical team domain enums, DTOs, label maps, and validators.
 *
 * Used by:
 * - DB schema (`src/server/database/init.ts`) to derive CHECK constraints
 * - Server routes returning team rows (`src/server/routes/teams.ts`)
 * - Client UI for status badges, labels, and any view that lists teams
 */

export const TEAM_STATUSES = [
  'registered',
  'checked_in',
  'no_show',
  'withdrawn',
] as const;

export type TeamStatus = (typeof TEAM_STATUSES)[number];

const TEAM_STATUS_SET: ReadonlySet<string> = new Set(TEAM_STATUSES);

export function isTeamStatus(value: unknown): value is TeamStatus {
  return typeof value === 'string' && TEAM_STATUS_SET.has(value);
}

export const TEAM_STATUS_LABELS: Record<TeamStatus, string> = {
  registered: 'Registered',
  checked_in: 'Checked In',
  no_show: 'No Show',
  withdrawn: 'Withdrawn',
};

/**
 * CSS-class hints for status badges/dots in the admin UI.
 * Kept here so all teams-status surfaces render consistent styling.
 */
export const TEAM_STATUS_BADGE_CLASSES: Record<TeamStatus, string> = {
  registered: 'status-registered',
  checked_in: 'status-checked-in',
  no_show: 'status-no-show',
  withdrawn: 'status-withdrawn',
};

/**
 * Canonical Team DTO returned by `GET /teams/event/:eventId`,
 * `GET /teams/:id`, and the create/update endpoints in
 * `src/server/routes/teams.ts`. Mirrors the columns of the `teams` table.
 *
 * Views that need only a subset of columns (e.g. dropdowns showing just
 * `team_number` / `team_name`) should still type their state as `Team` and
 * read the columns they need; this keeps a single source of truth for the
 * shape and lets TypeScript catch column renames across the codebase.
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
